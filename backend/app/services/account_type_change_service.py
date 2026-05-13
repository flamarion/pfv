"""Account-type change service (Edit Account Type).

This module owns the write path for ``PUT /api/v1/accounts/{id}`` calls
that mutate ``account_type_id`` or ``close_day``. It runs in its OWN
session/transaction (Pattern (b) in
``specs/2026-05-09-edit-account-type.md`` § 4.3) so the row lock
acquires on a fresh ``async with svc_db.begin():`` block without
colliding with the request-session autobegin from the auth dependency
chain. The router invokes this service when the body touches either of
those two columns; pure name / is_active / is_default / opening_balance
edits remain on the request session and do NOT pass through here.

Cascade rules (§ 3.1):

- Source S = current slug, Target T = target slug after the change.
- (not credit_card -> credit_card)  payload MUST carry close_day (400 if missing).
- (credit_card -> not credit_card)  server clears close_day to NULL; payload
   carrying a non-null close_day is rejected (400).
- (credit_card -> credit_card)      no-op on type; payload may set close_day.
- (not credit_card -> not credit_card)  payload MUST NOT carry close_day (400);
   this also covers the "no type change, only close_day on non-CC" hole the
   PUT path silently accepted before this spec.

Cross-org target type ID resolves to 422 (entity-not-for-you semantics)
to leave 400 reserved for cascade violations. Out-of-range close_day is
caught by Pydantic before this service runs (422).
"""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.models.account import Account, AccountType


_CC = "credit_card"


class TypeChangeResult:
    """Lightweight DTO so the router can audit-log and respond.

    Carries the post-commit snapshot. The route refetches via the
    request session for the response projection; this struct only
    feeds the audit payload.
    """

    __slots__ = (
        "account_id",
        "old_type_id",
        "new_type_id",
        "old_type_slug",
        "new_type_slug",
        "old_close_day",
        "new_close_day",
        "type_changed",
    )

    def __init__(
        self,
        *,
        account_id: int,
        old_type_id: int,
        new_type_id: int,
        old_type_slug: Optional[str],
        new_type_slug: Optional[str],
        old_close_day: Optional[int],
        new_close_day: Optional[int],
        type_changed: bool,
    ) -> None:
        self.account_id = account_id
        self.old_type_id = old_type_id
        self.new_type_id = new_type_id
        self.old_type_slug = old_type_slug
        self.new_type_slug = new_type_slug
        self.old_close_day = old_close_day
        self.new_close_day = new_close_day
        self.type_changed = type_changed


def validate_close_day_cascade(
    *,
    source_slug: Optional[str],
    target_slug: Optional[str],
    close_day_in_payload: bool,
    close_day_value: Optional[int],
) -> None:
    """Validate the cascade matrix in spec § 3.1. Raises HTTPException
    with the spec-locked status/detail strings; returns None on success.

    ``close_day_in_payload`` indicates whether the request body
    explicitly set the field (``"close_day" in body.model_fields_set``).
    A caller that omits the field has ``close_day_in_payload=False``;
    a caller that sends ``"close_day": null`` has
    ``close_day_in_payload=True`` and ``close_day_value=None``.
    """
    target_is_cc = target_slug == _CC

    # Target = credit_card => close_day required.
    if target_is_cc:
        if not close_day_in_payload or close_day_value is None:
            raise HTTPException(
                status_code=400,
                detail="close_day is required when changing to credit_card"
                if source_slug != _CC
                else "close_day is required for credit_card accounts",
            )
        # Range check is enforced by Pydantic (Field(ge=1, le=28)) so
        # by the time we reach this branch close_day is in [1, 28].
        return

    # Target != credit_card. Payload must NOT carry a non-null close_day.
    # This also closes the "close_day-only edit on non-CC account"
    # silent-tolerance hole called out in spec § 4.2 row 5.
    if close_day_in_payload and close_day_value is not None:
        raise HTTPException(
            status_code=400,
            detail="close_day is only allowed on credit_card accounts",
        )


def validate_create_close_day(
    *,
    target_slug: Optional[str],
    close_day_value: Optional[int],
) -> None:
    """Spec § 3.1.1 — create-path validation mirrors the PUT cascade.

    Distinct from ``validate_close_day_cascade`` because create has no
    "source slug" or "payload has the field set" concept. The
    ``AccountCreate`` schema declares ``close_day: Optional[int]``
    defaulting to ``None``, so we only check whether the resolved
    value is null/non-null against the target slug.
    """
    if target_slug == _CC and close_day_value is None:
        raise HTTPException(
            status_code=400,
            detail="close_day is required when creating a credit_card account",
        )
    if target_slug != _CC and close_day_value is not None:
        raise HTTPException(
            status_code=400,
            detail="close_day is only allowed on credit_card accounts",
        )


async def change_account_type(
    *,
    session_factory: async_sessionmaker[AsyncSession],
    account_id: int,
    org_id: int,
    target_type_id: int,
    close_day_in_payload: bool,
    close_day_value: Optional[int],
) -> TypeChangeResult:
    """Lock the row, validate the cascade, commit the type change.

    Runs on a fresh session/transaction (Pattern (b) per spec § 4.3) so
    the ``SELECT ... FOR UPDATE`` row lock cannot conflict with the
    auth-dependency autobegun transaction on the route's request
    session.

    Returns a snapshot the caller can hand to the audit-event
    recorder. Raises ``HTTPException`` for 400/404/422 outcomes.
    """
    async with session_factory() as svc_db:
        async with svc_db.begin():
            stmt = (
                select(Account)
                .options(selectinload(Account.account_type))
                .where(Account.id == account_id)
                .where(Account.org_id == org_id)
                .with_for_update()
            )
            account = (await svc_db.execute(stmt)).scalar_one_or_none()
            if account is None:
                raise HTTPException(status_code=404, detail="Account not found")

            old_type_id = account.account_type_id
            old_type_slug = (
                account.account_type.slug if account.account_type else None
            )
            old_close_day = account.close_day

            # Target-type existence + cross-org check. 422 (entity-not-for-you)
            # rather than 400, to leave 400 reserved for cascade violations
            # per spec § 4.2.
            target_type = (
                await svc_db.execute(
                    select(AccountType).where(
                        AccountType.id == target_type_id,
                        AccountType.org_id == org_id,
                    )
                )
            ).scalar_one_or_none()
            if target_type is None:
                raise HTTPException(
                    status_code=422, detail="Invalid account type"
                )
            target_slug = target_type.slug
            type_changed = target_type_id != old_type_id

            # Validate the cascade against the post-lock snapshot.
            validate_close_day_cascade(
                source_slug=old_type_slug,
                target_slug=target_slug,
                close_day_in_payload=close_day_in_payload,
                close_day_value=close_day_value,
            )

            # Apply: type first, then cascade the close_day column.
            account.account_type_id = target_type_id

            if target_slug == _CC:
                # Entering or staying-in CC: set/update the day from payload.
                # Validator above guarantees close_day_value is non-null here.
                account.close_day = close_day_value
            else:
                # Server-side clear when leaving CC, regardless of whether the
                # payload carried close_day. Idempotent for non-CC -> non-CC.
                account.close_day = None

            new_close_day = account.close_day

            # Context manager commits on clean exit. Do NOT call
            # await svc_db.commit() here -- spec § 4.3 warning.

    return TypeChangeResult(
        account_id=account_id,
        old_type_id=old_type_id,
        new_type_id=target_type_id,
        old_type_slug=old_type_slug,
        new_type_slug=target_slug,
        old_close_day=old_close_day,
        new_close_day=new_close_day,
        type_changed=type_changed,
    )
