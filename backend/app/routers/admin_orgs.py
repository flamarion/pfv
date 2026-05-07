"""Admin org-management router (L4.3).

Mounted at `/api/v1/admin/orgs`. Auth via the platform `orgs.view` /
`orgs.manage` permissions (superadmin short-circuits both today;
fine-grained roles can land later via L4.8 without touching this
file).

Destructive endpoints (DELETE, PUT subscription) emit a single
structlog event — prefix `admin.org.*` — so an operator can later
attribute who did what to whom even before the L4.7 audit table
exists. FK / SQL diagnostics never bleed into 500 bodies — generic
message client-side, full detail server-side.
"""

from datetime import datetime
from app._time import utcnow_naive

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
import structlog

from app.auth.feature_catalog import ALL_FEATURE_KEYS
from app.auth.permissions import require_permission
from app.database import get_db
from app.deps import get_current_user, get_session_factory
from app.models.feature_override import OrgFeatureOverride
from app.models.subscription import Plan, Subscription, SubscriptionStatus
from app.models.user import Organization, User
from app.rate_limit import get_client_ip
from app.schemas.admin_orgs import OrgDeleteRequest, SubscriptionUpdateRequest
from app.schemas.feature_override import FeatureOverrideUpsert, OrgFeatureOverrideResponse
from app.schemas.feature_state import FeatureStateResponse
from app.services import admin_orgs_service, audit_service, feature_service
from app.services.exceptions import ConflictError, NotFoundError, ValidationError

logger = structlog.stdlib.get_logger()

router = APIRouter(prefix="/api/v1/admin/orgs", tags=["admin-orgs"])


# Cap on the number of per-row entries embedded in the
# `admin.feature_override.expired_swept` audit detail. 50 is a
# reasonable ceiling for a JSON column and keeps the audit row
# readable in the admin UI; over the cap, the audit row carries
# `truncated_count` and `counts_by_feature` so the aggregate signal
# survives even if individual rows fall off.
_SWEEP_AUDIT_ENTRY_CAP = 50


def _request_id() -> str | None:
    """Pull the per-request id bound by RequestContextMiddleware (L4.9)."""
    return structlog.contextvars.get_contextvars().get("request_id")


@router.get(
    "",
    dependencies=[Depends(require_permission("orgs.view"))],
)
async def list_orgs(
    q: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    return await admin_orgs_service.list_orgs(db, q=q, limit=limit, offset=offset)


@router.get(
    "/{org_id}",
    dependencies=[Depends(require_permission("orgs.view"))],
)
async def get_org_detail(org_id: int, db: AsyncSession = Depends(get_db)):
    try:
        return await admin_orgs_service.get_org_detail(db, org_id=org_id)
    except NotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")


@router.put("/{org_id}/subscription")
async def update_org_subscription(
    org_id: int,
    body: SubscriptionUpdateRequest,
    request: Request,
    current_user: User = Depends(require_permission("orgs.manage")),
    db: AsyncSession = Depends(get_db),
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
):
    try:
        # Look up name once for the audit event.
        detail = await admin_orgs_service.get_org_detail(db, org_id=org_id)
    except NotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    try:
        before, after = await admin_orgs_service.update_subscription(
            db,
            org_id=org_id,
            plan_id=body.plan_id,
            status=SubscriptionStatus(body.status) if body.status else None,
            trial_end=body.trial_end,
            current_period_end=body.current_period_end,
        )
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    await db.commit()

    await logger.ainfo(
        "admin.org.subscription.override",
        actor_user_id=current_user.id,
        actor_email=current_user.email,
        target_org_id=org_id,
        target_org_name=detail["name"],
        before=before,
        after=after,
    )
    await audit_service.record_audit_event(
        session_factory,
        event_type="admin.org.subscription.override",
        actor_user_id=current_user.id,
        actor_email=current_user.email,
        target_org_id=org_id,
        target_org_name=detail["name"],
        request_id=_request_id(),
        ip_address=get_client_ip(request),
        outcome="success",
        detail={"before": before, "after": after},
    )
    return {"before": before, "after": after}


@router.delete("/{org_id}")
async def delete_org(
    org_id: int,
    body: OrgDeleteRequest,
    request: Request,
    current_user: User = Depends(require_permission("orgs.manage")),
    db: AsyncSession = Depends(get_db),
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
):
    if org_id == current_user.org_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete your own organization",
        )

    try:
        detail = await admin_orgs_service.get_org_detail(db, org_id=org_id)
    except NotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    if body.confirm_name.strip() != detail["name"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="confirm_name does not match organization name",
        )

    # Snapshot the org's identifying fields BEFORE the delete so the
    # durable audit row carries answers to "what was deleted" even
    # after the FK ON DELETE SET NULL cascade nulls target_org_id.
    # Bounded — counts not member lists, no PII beyond what the audit
    # table already accepts.
    org_snapshot = {
        "org_id": org_id,
        "org_name": detail["name"],
        "created_at": detail.get("created_at"),
        "billing_cycle_day": detail.get("billing_cycle_day"),
        "member_count_at_delete": len(detail.get("members") or []),
        "subscription": detail.get("subscription"),
        "deleted_by_user_id": current_user.id,
        "deleted_by_email": current_user.email,
    }

    try:
        # 1) Stage the success audit row FIRST so the FK
        #    (target_org_id → organizations.id) still resolves at
        #    INSERT time — the org row is still present.
        # 2) Run delete_org_cascade. The cascade includes the org row
        #    DELETE; the FK is ON DELETE SET NULL, so the audit row's
        #    target_org_id is nulled by the DB at the same time.
        # 3) Update the audit row's `detail` with the deleted_rows
        #    counts and commit. All atomic — audit row exists iff
        #    delete succeeded.
        # Snapshot in `detail.snapshot` preserves the org's identity
        # after the cascade nulls target_org_id, which is the whole
        # point of writing this row before the delete.
        audit_row = audit_service.add_audit_event_to_session(
            db,
            event_type="admin.org.delete",
            actor_user_id=current_user.id,
            actor_email=current_user.email,
            target_org_id=org_id,
            target_org_name=detail["name"],
            request_id=_request_id(),
            ip_address=get_client_ip(request),
            outcome="success",
            detail={"snapshot": org_snapshot},
        )
        # Flush so the audit row is INSERTed with the FK still
        # satisfiable (org row still present), before the cascade
        # tears the org away.
        await db.flush()
        counts = await admin_orgs_service.delete_org_cascade(db, org_id=org_id)
        # Reassign the JSON detail (SQLAlchemy doesn't track in-place
        # dict mutation on JSON columns by default).
        audit_row.detail = {
            "snapshot": org_snapshot,
            "deleted_rows_by_table": counts,
        }
        await db.commit()
    except Exception as e:  # noqa: BLE001 — translate to generic 500 + log.
        await db.rollback()
        await logger.aerror(
            "admin.org.delete.failed",
            actor_user_id=current_user.id,
            actor_email=current_user.email,
            target_org_id=org_id,
            target_org_name=detail["name"],
            error=str(e),
            error_type=type(e).__name__,
        )
        # Independent-session audit write — the business txn has been
        # rolled back (taking the staged success row with it), but the
        # failure must still appear in the audit log. That's the whole
        # point of opening a fresh session for the audit row.
        await audit_service.record_audit_event(
            session_factory,
            event_type="admin.org.delete.failed",
            actor_user_id=current_user.id,
            actor_email=current_user.email,
            target_org_id=org_id,
            target_org_name=detail["name"],
            request_id=_request_id(),
            ip_address=get_client_ip(request),
            outcome="failure",
            detail={
                "snapshot": org_snapshot,
                "error": str(e),
                "error_type": type(e).__name__,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete organization",
        )

    await logger.ainfo(
        "admin.org.delete",
        actor_user_id=current_user.id,
        actor_email=current_user.email,
        target_org_id=org_id,
        target_org_name=detail["name"],
        deleted_rows_by_table=counts,
    )
    return {"deleted": counts}


# ── Feature overrides (L4.11) ─────────────────────────────────────────────


def _validate_feature_key(key: str) -> None:
    if key not in ALL_FEATURE_KEYS:
        raise ValidationError(f"Unknown feature key: {key!r}")


async def _override_to_response(row: OrgFeatureOverride, db: AsyncSession) -> dict:
    """Resolve set_by_email by joining to users."""
    email = None
    if row.set_by is not None:
        email = await db.scalar(select(User.email).where(User.id == row.set_by))
    is_expired = row.expires_at is not None and row.expires_at <= utcnow_naive()
    return {
        "feature_key": row.feature_key,
        "value": row.value,
        "set_by": row.set_by,
        "set_by_email": email,
        "set_at": row.set_at.isoformat() if row.set_at else None,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "note": row.note,
        "is_expired": is_expired,
    }


@router.post("/feature-overrides/sweep-expired")
async def sweep_expired_feature_overrides(
    request: Request,
    user: User = Depends(require_permission("orgs.manage")),
    db: AsyncSession = Depends(get_db),
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
):
    """Delete every ``org_feature_overrides`` row whose ``expires_at``
    is in the past. Idempotent (returns ``deleted_count: 0`` when nothing
    matches). Audit row is always written.

    Audit detail (PR-C / PR #141 #1) includes a bounded summary of the
    rows that were deleted so ops can answer "which orgs/features lost
    access" without reaching for structlog. ``entries`` is capped at
    ``_SWEEP_AUDIT_ENTRY_CAP``; over the cap, ``truncated_count`` and
    ``counts_by_feature`` carry the rest.
    """
    cutoff = utcnow_naive()
    # SELECT the rows that will be deleted FIRST so we can record their
    # identity in the audit row. Reading and deleting in the same txn
    # guarantees the audit summary is exactly what was removed.
    expiring_rows = (
        await db.execute(
            select(OrgFeatureOverride)
            .where(OrgFeatureOverride.expires_at.is_not(None))
            .where(OrgFeatureOverride.expires_at <= cutoff)
            .order_by(OrgFeatureOverride.org_id, OrgFeatureOverride.feature_key)
        )
    ).scalars().all()
    deleted_count = len(expiring_rows)

    # Build the bounded audit detail. counts_by_feature is the
    # truth-as-aggregate; entries is a capped sample for spot-checks.
    counts_by_feature: dict[str, int] = {}
    for row in expiring_rows:
        counts_by_feature[row.feature_key] = (
            counts_by_feature.get(row.feature_key, 0) + 1
        )
    entries = [
        {
            "org_id": row.org_id,
            "feature_key": row.feature_key,
            "value": row.value,
            "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        }
        for row in expiring_rows[:_SWEEP_AUDIT_ENTRY_CAP]
    ]
    truncated_count = max(0, deleted_count - _SWEEP_AUDIT_ENTRY_CAP)

    if expiring_rows:
        await db.execute(
            delete(OrgFeatureOverride)
            .where(OrgFeatureOverride.expires_at.is_not(None))
            .where(OrgFeatureOverride.expires_at <= cutoff)
        )
    await db.commit()

    await logger.ainfo(
        "admin.feature_override.expired_swept",
        actor_user_id=user.id,
        actor_email=user.email,
        deleted_count=deleted_count,
    )
    await audit_service.record_audit_event(
        session_factory,
        event_type="admin.feature_override.expired_swept",
        actor_user_id=user.id,
        actor_email=user.email,
        target_org_id=None,
        target_org_name=None,
        request_id=_request_id(),
        ip_address=get_client_ip(request),
        outcome="success",
        detail={
            "deleted_count": deleted_count,
            "entries": entries,
            "truncated_count": truncated_count,
            "counts_by_feature": counts_by_feature,
        },
    )
    return {"deleted_count": deleted_count}


@router.put(
    "/{org_id}/feature-overrides/{feature_key}",
    response_model=OrgFeatureOverrideResponse,
)
async def set_feature_override(
    org_id: int,
    feature_key: str,
    body: FeatureOverrideUpsert,
    request: Request,
    user: User = Depends(require_permission("orgs.manage")),
    db: AsyncSession = Depends(get_db),
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
):
    try:
        _validate_feature_key(feature_key)
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    org_row = (
        await db.execute(select(Organization).where(Organization.id == org_id))
    ).scalar_one_or_none()
    if org_row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )
    target_org_name = org_row.name

    existing = await db.scalar(
        select(OrgFeatureOverride).where(
            OrgFeatureOverride.org_id == org_id,
            OrgFeatureOverride.feature_key == feature_key,
        )
    )
    old_value = existing.value if existing else None
    old_expires_at = existing.expires_at if existing else None

    try:
        async with db.begin_nested():
            if existing is None:
                row = OrgFeatureOverride(
                    org_id=org_id,
                    feature_key=feature_key,
                    value=body.value,
                    set_by=user.id,
                    expires_at=body.expires_at,
                    note=body.note,
                )
                db.add(row)
            else:
                existing.value = body.value
                existing.set_by = user.id
                existing.set_at = utcnow_naive()
                existing.expires_at = body.expires_at
                existing.note = body.note
                row = existing
        await db.commit()
        await db.refresh(row)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Override changed concurrently; retry.",
        )

    await logger.ainfo(
        "admin.org.feature.set",
        target_org_id=org_id,
        feature_key=feature_key,
        old_value=old_value,
        new_value=body.value,
        old_expires_at=old_expires_at.isoformat() if old_expires_at else None,
        new_expires_at=body.expires_at.isoformat() if body.expires_at else None,
        actor_user_id=user.id,
        actor_email=user.email,
        note_present=body.note is not None,
    )
    await audit_service.record_audit_event(
        session_factory,
        event_type="admin.org.feature.set",
        actor_user_id=user.id,
        actor_email=user.email,
        target_org_id=org_id,
        target_org_name=target_org_name,
        request_id=_request_id(),
        ip_address=get_client_ip(request),
        outcome="success",
        detail={
            "feature_key": feature_key,
            "old_value": old_value,
            "new_value": body.value,
            "old_expires_at": old_expires_at.isoformat() if old_expires_at else None,
            "new_expires_at": body.expires_at.isoformat() if body.expires_at else None,
            "note_present": body.note is not None,
        },
    )

    return await _override_to_response(row, db)


@router.delete(
    "/{org_id}/feature-overrides/{feature_key}",
    status_code=204,
)
async def revoke_feature_override(
    org_id: int,
    feature_key: str,
    request: Request,
    user: User = Depends(require_permission("orgs.manage")),
    db: AsyncSession = Depends(get_db),
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
):
    # 400 if key isn't in the catalog (matches PUT translation).
    try:
        _validate_feature_key(feature_key)
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    org_row = (
        await db.execute(select(Organization).where(Organization.id == org_id))
    ).scalar_one_or_none()
    if org_row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )
    target_org_name = org_row.name

    existing = await db.scalar(
        select(OrgFeatureOverride).where(
            OrgFeatureOverride.org_id == org_id,
            OrgFeatureOverride.feature_key == feature_key,
        )
    )
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"FeatureOverride {org_id}/{feature_key} not found",
        )

    old_value = existing.value
    await db.delete(existing)
    await db.commit()

    await logger.ainfo(
        "admin.org.feature.revoked",
        target_org_id=org_id,
        feature_key=feature_key,
        old_value=old_value,
        actor_user_id=user.id,
        actor_email=user.email,
    )
    await audit_service.record_audit_event(
        session_factory,
        event_type="admin.org.feature.revoked",
        actor_user_id=user.id,
        actor_email=user.email,
        target_org_id=org_id,
        target_org_name=target_org_name,
        request_id=_request_id(),
        ip_address=get_client_ip(request),
        outcome="success",
        detail={"feature_key": feature_key, "old_value": old_value},
    )
    return Response(status_code=204)


# ── Feature state composite (T16) ────────────────────────────────────────


@router.get(
    "/{org_id}/feature-state",
    response_model=FeatureStateResponse,
)
async def get_feature_state(
    org_id: int,
    user: User = Depends(require_permission("orgs.view")),
    db: AsyncSession = Depends(get_db),
):
    # 404 explicit on missing target org. Resolver fail-closed (all-False)
    # is for product feature gates against the auth user's own org;
    # admin reads have a different contract.
    org = await db.scalar(select(Organization).where(Organization.id == org_id))
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    plan_features = await feature_service._fetch_plan_features(db, org_id)

    plan_row = await db.execute(
        select(Plan.id, Plan.name, Plan.slug)
        .join(Subscription, Subscription.plan_id == Plan.id)
        .where(Subscription.org_id == org_id)
    )
    plan_data = plan_row.first()
    plan_summary = (
        {"id": plan_data.id, "name": plan_data.name, "slug": plan_data.slug}
        if plan_data else None
    )

    # All overrides (active + expired) joined to setter email.
    rows = await db.execute(
        select(OrgFeatureOverride, User.email)
        .outerjoin(User, User.id == OrgFeatureOverride.set_by)
        .where(OrgFeatureOverride.org_id == org_id)
    )
    now = utcnow_naive()
    overrides_by_key: dict[str, dict] = {}
    for row, email in rows.all():
        if row.feature_key not in ALL_FEATURE_KEYS:
            continue  # defensive filter
        is_expired = row.expires_at is not None and row.expires_at <= now
        overrides_by_key[row.feature_key] = {
            "feature_key": row.feature_key,
            "value": row.value,
            "set_by": row.set_by,
            "set_by_email": email,
            "set_at": row.set_at.isoformat() if row.set_at else None,
            "expires_at": row.expires_at.isoformat() if row.expires_at else None,
            "note": row.note,
            "is_expired": is_expired,
        }

    feature_rows = []
    for key in sorted(ALL_FEATURE_KEYS):
        plan_default = plan_features.get(key, False)
        ovr = overrides_by_key.get(key)
        effective = ovr["value"] if (ovr and not ovr["is_expired"]) else plan_default
        feature_rows.append({
            "key": key,
            "plan_default": plan_default,
            "effective": effective,
            "override": ovr,
        })

    return {"plan": plan_summary, "features": feature_rows}
