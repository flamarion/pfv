"""Wrapper-layer breadcrumbs for the auth Redis call path.

Gated by ``settings.auth_debug_logging`` so production stays quiet
under normal operation. When the flag is flipped on during incident
triage, every wrapped Redis op emits ``redis.call.start`` and either
``redis.call.ok`` or ``redis.call.error`` with the function name and
duration — that data was the missing piece on the 2026-05-20 silent
46 s hang where uvicorn never emitted an access log because the
handler hung mid-await.
"""

from __future__ import annotations

import logging

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import ResponseError as RedisResponseError

from app.redis_client import _normalize_transport_errors


class TestBreadcrumbsGated:
    @pytest.mark.asyncio
    async def test_breadcrumbs_silent_when_flag_off(
        self,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Default-off: zero ``redis.call.*`` events emitted regardless
        of success or failure. Production noise floor stays untouched."""
        import app.config as cfg
        import app.redis_client as rc

        monkeypatch.setattr(cfg.settings, "auth_debug_logging", False)
        caplog.set_level(logging.INFO, logger=rc.logger.name)

        @_normalize_transport_errors
        async def helper() -> int:
            return 1

        result = await helper()
        assert result == 1
        breadcrumbs = [r for r in caplog.records if r.msg.startswith("redis.call.")]
        assert breadcrumbs == [], (
            f"expected no breadcrumbs with flag off; got {[r.msg for r in breadcrumbs]}"
        )

    @pytest.mark.asyncio
    async def test_breadcrumbs_on_success(
        self,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Flag-on success path emits start + ok with op name and
        duration. The wrapped function's ``__name__`` is the
        operator-visible op label — preserved by ``functools.wraps``."""
        import app.config as cfg
        import app.redis_client as rc

        monkeypatch.setattr(cfg.settings, "auth_debug_logging", True)
        caplog.set_level(logging.INFO, logger=rc.logger.name)

        @_normalize_transport_errors
        async def session_validate() -> str:
            return "ok"

        await session_validate()

        events = [r for r in caplog.records if r.msg.startswith("redis.call.")]
        assert [r.msg for r in events] == ["redis.call.start", "redis.call.ok"]
        # Both events carry the op name; ok event also carries duration.
        for record in events:
            assert getattr(record, "op", None) == "session_validate"
        ok_event = events[1]
        assert isinstance(getattr(ok_event, "duration_ms", None), (int, float))

    @pytest.mark.asyncio
    async def test_breadcrumbs_on_redis_error(
        self,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """RedisError still propagates unchanged AND the wrapper emits a
        ``redis.call.error`` breadcrumb carrying the error class so the
        operator can grep for transient ConnectionError bursts vs Lua
        ResponseError without spelunking tracebacks."""
        import app.config as cfg
        import app.redis_client as rc

        monkeypatch.setattr(cfg.settings, "auth_debug_logging", True)
        caplog.set_level(logging.INFO, logger=rc.logger.name)

        @_normalize_transport_errors
        async def session_rotate_lua() -> None:
            raise RedisResponseError("session_revoked")

        with pytest.raises(RedisResponseError):
            await session_rotate_lua()

        events = [r for r in caplog.records if r.msg.startswith("redis.call.")]
        assert [r.msg for r in events] == ["redis.call.start", "redis.call.error"]
        error_event = events[1]
        assert getattr(error_event, "op", None) == "session_rotate_lua"
        assert getattr(error_event, "error_class", None) == "ResponseError"

    @pytest.mark.asyncio
    async def test_breadcrumbs_on_oserror_translation(
        self,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """OSError is translated to RedisConnectionError by the wrapper.
        The breadcrumb on the error path must carry the ORIGINAL error
        class name (``BrokenPipeError``) so the operator can tell the
        transport-failure class apart from a normal RedisConnectionError
        that some other layer raised."""
        import app.config as cfg
        import app.redis_client as rc
        from unittest.mock import AsyncMock, MagicMock

        monkeypatch.setattr(cfg.settings, "auth_debug_logging", True)
        caplog.set_level(logging.INFO, logger=rc.logger.name)

        # Retirement path needs a sentinel client to drop; install one
        # so the wrapper completes its full path.
        sentinel_client = MagicMock()
        sentinel_client.aclose = AsyncMock()
        rc._client = sentinel_client

        @_normalize_transport_errors
        async def session_validate() -> None:
            raise BrokenPipeError(32, "Broken pipe")

        with pytest.raises(RedisConnectionError):
            await session_validate()

        events = [r for r in caplog.records if r.msg.startswith("redis.call.")]
        assert [r.msg for r in events] == ["redis.call.start", "redis.call.error"]
        assert getattr(events[1], "error_class", None) == "BrokenPipeError"
