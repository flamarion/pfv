"""Tests for the L4.9 request-context middleware + auth-time binding.

Two concerns under test:

1. Every request gets a ``request_id`` bound onto structlog's
   contextvars and echoed back as the ``X-Request-Id`` response
   header. An inbound ``X-Request-Id`` is preserved if reasonable.
2. Once auth resolves through ``deps.get_current_user``, the same
   contextvar pool also carries ``user_id`` / ``org_id`` / ``role``,
   so any structlog event from the rest of the request inherits the
   authenticated context.
"""
from __future__ import annotations

import structlog
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.middleware.request_context import RequestContextMiddleware


def _build_app(captured: list[dict]) -> FastAPI:
    """Minimal app that exposes the structlog contextvars at request
    time. Captures one snapshot per request into ``captured`` so the
    test can assert what was bound.
    """
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)

    @app.get("/echo")
    async def echo(request: Request):
        # Snapshot contextvars *during* the request — i.e., before the
        # middleware clears them on the next request. Mirrors what any
        # structlog event would carry.
        captured.append(dict(structlog.contextvars.get_contextvars()))
        return {
            "request_id_state": getattr(request.state, "request_id", None),
        }

    return app


def test_middleware_generates_request_id_when_missing():
    captured: list[dict] = []
    with TestClient(_build_app(captured)) as client:
        res = client.get("/echo")
    assert res.status_code == 200
    assert "x-request-id" in {k.lower() for k in res.headers}
    rid = res.headers.get("x-request-id")
    assert rid and len(rid) >= 8
    # The handler saw the same id under structlog contextvars.
    assert captured[-1].get("request_id") == rid
    # And it was stashed on request.state for handler reuse.
    assert res.json()["request_id_state"] == rid


def test_middleware_preserves_inbound_request_id():
    captured: list[dict] = []
    with TestClient(_build_app(captured)) as client:
        res = client.get("/echo", headers={"X-Request-Id": "trace-abc-123"})
    assert res.status_code == 200
    assert res.headers.get("x-request-id") == "trace-abc-123"
    assert captured[-1].get("request_id") == "trace-abc-123"


def test_middleware_rejects_overlong_inbound_request_id():
    """Caller-supplied id past the bounded length is replaced with a
    fresh UUID — keeps log size bounded and avoids log injection via
    pathological header values.
    """
    captured: list[dict] = []
    huge = "x" * 200
    with TestClient(_build_app(captured)) as client:
        res = client.get("/echo", headers={"X-Request-Id": huge})
    assert res.status_code == 200
    assert res.headers.get("x-request-id") != huge
    assert len(res.headers["x-request-id"]) <= 64


def test_middleware_clears_contextvars_between_requests():
    """A second request starts with a fresh scope — no stale state."""
    captured: list[dict] = []
    with TestClient(_build_app(captured)) as client:
        client.get("/echo", headers={"X-Request-Id": "first-req"})
        client.get("/echo", headers={"X-Request-Id": "second-req"})
    assert captured[0].get("request_id") == "first-req"
    assert captured[1].get("request_id") == "second-req"
    # Crucially: second request's contextvars do NOT contain the
    # first request's id (or any field that wasn't rebind under the
    # second scope).
    assert "first-req" not in captured[1].values()


def test_middleware_rejects_non_printable_inbound_id():
    """Control characters in the inbound id are not echoed verbatim;
    we generate a fresh one. Avoids log-line injection via embedded
    newlines or terminal escape sequences.
    """
    captured: list[dict] = []
    bad = "abc\ninjected"
    with TestClient(_build_app(captured)) as client:
        res = client.get("/echo", headers={"X-Request-Id": bad})
    assert res.status_code == 200
    assert "\n" not in res.headers.get("x-request-id", "")
    assert res.headers.get("x-request-id") != bad


# ── Auth-time context binding ─────────────────────────────────────────────


import pytest

import app.deps as deps_module
from app.deps import get_current_user
from app.models.user import Role, User
from fastapi.security import HTTPAuthorizationCredentials


class _FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeAsyncSession:
    def __init__(self, value):
        self._value = value

    async def execute(self, _stmt):
        return _FakeResult(self._value)


def _make_user(**overrides) -> User:
    base = {
        "id": 7,
        "org_id": 42,
        "username": "alice",
        "email": "alice@example.com",
        "password_hash": "x",
        "role": Role.OWNER,
        "is_superadmin": False,
        "is_active": True,
    }
    base.update(overrides)
    return User(**base)


@pytest.mark.asyncio
async def test_get_current_user_binds_authenticated_context(monkeypatch) -> None:
    """Once auth resolves, structlog contextvars carry user_id /
    org_id / role for the rest of the request — that's the L4.9
    promise. Verified by snapshotting the contextvars after the dep
    returns.
    """
    structlog.contextvars.clear_contextvars()

    user = _make_user(id=7, org_id=42, role=Role.OWNER)
    monkeypatch.setattr(
        deps_module,
        "decode_token",
        lambda _t: {"sub": "7", "type": "access"},
    )

    resolved = await get_current_user(
        HTTPAuthorizationCredentials(scheme="Bearer", credentials="signed-token"),
        _FakeAsyncSession(user),
    )
    assert resolved is user

    bound = structlog.contextvars.get_contextvars()
    assert bound.get("user_id") == 7
    assert bound.get("org_id") == 42
    assert bound.get("role") == "owner"

    # Cleanup so subsequent tests see a fresh scope.
    structlog.contextvars.clear_contextvars()
