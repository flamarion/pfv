"""Tests for the per-org reset lock service.

Closes the residual risk logged on PR #134: two concurrent reset
POSTs could otherwise interleave through the per-batch commits and
the app-level idempotent seed and duplicate the post-wipe defaults.
"""
from __future__ import annotations

import datetime

import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.org_data_reset_lock import OrgDataResetLock
from app.models.user import Organization, User
from app.services import org_reset_lock_service


@event.listens_for(Engine, "connect")
def _enable_sqlite_fk(conn, _record):  # noqa: D401
    cursor = conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


@pytest_asyncio.fixture
async def session_factory():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory
    await engine.dispose()


async def _seed_org_and_user(factory) -> tuple[int, int]:
    async with factory() as db:
        org = Organization(name="Acme")
        db.add(org)
        await db.flush()
        user = User(
            username="u",
            email="u@x.io",
            email_verified=True,
            password_hash="x",
            org_id=org.id,
            role="owner",
        )
        db.add(user)
        await db.commit()
        return org.id, user.id


@pytest.mark.asyncio
async def test_acquire_succeeds_when_no_existing_lock(session_factory):
    org_id, user_id = await _seed_org_and_user(session_factory)
    async with session_factory() as db:
        ok = await org_reset_lock_service.acquire_reset_lock(
            db, org_id=org_id, user_id=user_id,
        )
    assert ok is True
    async with session_factory() as db:
        row = await db.scalar(
            select(OrgDataResetLock).where(OrgDataResetLock.org_id == org_id)
        )
        assert row is not None
        assert row.acquired_by_user_id == user_id


@pytest.mark.asyncio
async def test_acquire_fails_when_fresh_lock_already_held(session_factory):
    org_id, user_id = await _seed_org_and_user(session_factory)
    async with session_factory() as db:
        first = await org_reset_lock_service.acquire_reset_lock(
            db, org_id=org_id, user_id=user_id,
        )
    assert first is True
    async with session_factory() as db:
        second = await org_reset_lock_service.acquire_reset_lock(
            db, org_id=org_id, user_id=user_id,
        )
    assert second is False


@pytest.mark.asyncio
async def test_acquire_overrides_stale_lock(session_factory):
    """A lock older than LOCK_TTL_MINUTES is overridable so a crashed
    worker doesn't block future resets indefinitely.
    """
    org_id, user_id = await _seed_org_and_user(session_factory)
    stale_ts = datetime.datetime.utcnow() - datetime.timedelta(hours=1)
    async with session_factory() as db:
        db.add(OrgDataResetLock(
            org_id=org_id,
            acquired_by_user_id=user_id,
            acquired_at=stale_ts,
        ))
        await db.commit()

    async with session_factory() as db:
        ok = await org_reset_lock_service.acquire_reset_lock(
            db, org_id=org_id, user_id=user_id,
        )
    assert ok is True

    async with session_factory() as db:
        row = await db.scalar(
            select(OrgDataResetLock).where(OrgDataResetLock.org_id == org_id)
        )
        assert row.acquired_at > stale_ts


@pytest.mark.asyncio
async def test_release_is_idempotent(session_factory):
    org_id, _user_id = await _seed_org_and_user(session_factory)

    async with session_factory() as db:
        await org_reset_lock_service.release_reset_lock(db, org_id=org_id)

    async with session_factory() as db:
        await org_reset_lock_service.acquire_reset_lock(
            db, org_id=org_id, user_id=1,
        )
    async with session_factory() as db:
        await org_reset_lock_service.release_reset_lock(db, org_id=org_id)
    async with session_factory() as db:
        await org_reset_lock_service.release_reset_lock(db, org_id=org_id)

    async with session_factory() as db:
        row = await db.scalar(
            select(OrgDataResetLock).where(OrgDataResetLock.org_id == org_id)
        )
    assert row is None


@pytest.mark.asyncio
async def test_acquire_release_acquire_cycle(session_factory):
    """After a release, the next acquire succeeds again — the canonical
    happy path of one reset finishing cleanly and another starting.
    """
    org_id, user_id = await _seed_org_and_user(session_factory)

    async with session_factory() as db:
        first = await org_reset_lock_service.acquire_reset_lock(
            db, org_id=org_id, user_id=user_id,
        )
    assert first is True

    async with session_factory() as db:
        await org_reset_lock_service.release_reset_lock(db, org_id=org_id)

    async with session_factory() as db:
        second = await org_reset_lock_service.acquire_reset_lock(
            db, org_id=org_id, user_id=user_id,
        )
    assert second is True


@pytest.mark.asyncio
async def test_is_reset_locked_reflects_state(session_factory):
    org_id, user_id = await _seed_org_and_user(session_factory)

    async with session_factory() as db:
        assert await org_reset_lock_service.is_reset_locked(db, org_id=org_id) is False

    async with session_factory() as db:
        await org_reset_lock_service.acquire_reset_lock(
            db, org_id=org_id, user_id=user_id,
        )
    async with session_factory() as db:
        assert await org_reset_lock_service.is_reset_locked(db, org_id=org_id) is True

    async with session_factory() as db:
        await org_reset_lock_service.release_reset_lock(db, org_id=org_id)
    async with session_factory() as db:
        assert await org_reset_lock_service.is_reset_locked(db, org_id=org_id) is False
