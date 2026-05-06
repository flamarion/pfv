"""Per-org exclusive lease for in-flight org-data resets.

The reset path commits per batch and runs an app-level idempotent
seed (``seed_org_defaults``). Two concurrent reset POSTs that
interleave on the same org could duplicate seeded defaults because
``account_types`` and ``categories`` carry no DB-level UNIQUE on
``(org_id, slug, is_system)``. This service provides a server-side
lock keyed on the org PK to make the reset path strictly serial
per org.

Contract:
- ``acquire_reset_lock`` returns True if the lease was taken, False
  if another reset is in flight. Stale locks (older than
  ``LOCK_TTL_MINUTES``) are auto-recovered so a crashed worker
  cannot indefinitely block future resets.
- ``release_reset_lock`` is idempotent — safe to call from a
  ``finally`` even if acquire raised.
- The endpoint commits each lock state change immediately. The
  reset path's own per-batch commits don't affect lock state.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import delete, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.org_data_reset_lock import OrgDataResetLock

# How long a lock is considered fresh. After this window an in-flight
# acquire can override the existing lock — recovery path for workers
# that crashed mid-reset and never released. 30 minutes is far longer
# than the worst-case real reset duration but short enough that an
# operator doesn't have to manually clear stuck rows.
LOCK_TTL_MINUTES = 30


async def acquire_reset_lock(
    db: AsyncSession,
    *,
    org_id: int,
    user_id: int,
) -> bool:
    """Try to acquire the exclusive reset lease for ``org_id``.

    Returns True if acquired (caller must call
    ``release_reset_lock`` in finally). Returns False if another
    reset is already in flight.

    Stale-lock recovery: if a row exists but its ``acquired_at`` is
    older than ``LOCK_TTL_MINUTES``, the lock is forcibly taken over
    by the new caller. This keeps a crashed worker from blocking
    future resets indefinitely.
    """
    now = datetime.utcnow()
    cutoff = now - timedelta(minutes=LOCK_TTL_MINUTES)

    # Fast path: try INSERT. If no row exists for this org, this
    # succeeds atomically against the PK constraint.
    try:
        await db.execute(
            insert(OrgDataResetLock).values(
                org_id=org_id,
                acquired_by_user_id=user_id,
                acquired_at=now,
            )
        )
        await db.commit()
        return True
    except IntegrityError:
        await db.rollback()

    # Slow path: a row already exists. Take it over only if stale.
    # Use a conditional UPDATE so the takeover is atomic — if a
    # racing caller refreshes the row between our SELECT and UPDATE,
    # rowcount=0 and we report contention.
    result = await db.execute(
        update(OrgDataResetLock)
        .where(
            OrgDataResetLock.org_id == org_id,
            OrgDataResetLock.acquired_at < cutoff,
        )
        .values(acquired_by_user_id=user_id, acquired_at=now)
    )
    if (result.rowcount or 0) > 0:
        await db.commit()
        return True

    await db.rollback()
    return False


async def release_reset_lock(db: AsyncSession, *, org_id: int) -> None:
    """Release the lock. Idempotent — calling on a non-existent row
    is a no-op. Safe to call from a finally block whether acquire
    succeeded or raised.
    """
    await db.execute(
        delete(OrgDataResetLock).where(OrgDataResetLock.org_id == org_id)
    )
    await db.commit()


async def is_reset_locked(db: AsyncSession, *, org_id: int) -> bool:
    """Diagnostic helper for tests + admin debugging. Returns True if
    a fresh (non-stale) lock exists for ``org_id``.
    """
    cutoff = datetime.utcnow() - timedelta(minutes=LOCK_TTL_MINUTES)
    row = await db.scalar(
        select(OrgDataResetLock).where(
            OrgDataResetLock.org_id == org_id,
            OrgDataResetLock.acquired_at >= cutoff,
        )
    )
    return row is not None
