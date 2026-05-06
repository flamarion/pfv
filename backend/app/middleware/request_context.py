"""ASGI middleware that binds a per-request correlation context.

Fires at the start of every request, before route deps resolve:

- Clears structlog's contextvars (fresh per-request scope; never bleed
  state from a previous request that crashed mid-handler).
- Reads ``X-Request-Id`` from the incoming headers if present, else
  generates a UUID4 hex. Either way the value is bound into structlog
  contextvars under the ``request_id`` key so every event the request
  emits — including the access log produced from uvicorn — carries it.
- Stashes the same value on ``request.state.request_id`` so deps and
  handlers can read it directly without re-deriving.
- Echoes the value back as ``X-Request-Id`` on the response so callers
  (frontend, nginx, ops) can correlate.

User / org / role context is bound LATER, inside ``deps.get_current_user``
once the JWT resolves — middleware can't know who the caller is yet.
That binding piggybacks on the same contextvar pool here, so both
the request_id and the auth context land on every event from the
moment auth completes.
"""
from __future__ import annotations

import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.types import ASGIApp


# Maximum length of an inbound request id we'll accept verbatim. Past
# this we generate a fresh UUID4 instead of trusting the caller's
# value — keeps log size bounded and avoids a vector for log injection
# via overlong header values.
_MAX_INBOUND_LENGTH = 64


def _coerce_request_id(raw: str | None) -> str:
    """Return a safe-to-log request id. Reuses the inbound value when
    present + bounded; otherwise generates a fresh UUID4 hex.
    """
    if raw and 0 < len(raw) <= _MAX_INBOUND_LENGTH:
        # Strip whitespace and printable-only-control chars at the
        # boundary; the caller's value is otherwise opaque to us.
        cleaned = raw.strip()
        if cleaned and cleaned.isprintable():
            return cleaned
    return uuid.uuid4().hex


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Binds request_id (and clears prior contextvars) per request."""

    def __init__(self, app: ASGIApp, header_name: str = "x-request-id") -> None:
        super().__init__(app)
        self.header_name = header_name

    async def dispatch(self, request: Request, call_next):
        # Fresh scope per request — never bleed state from a previous
        # request that crashed mid-handler.
        structlog.contextvars.clear_contextvars()

        request_id = _coerce_request_id(request.headers.get(self.header_name))
        request.state.request_id = request_id
        structlog.contextvars.bind_contextvars(request_id=request_id)

        response = await call_next(request)
        # Echo the id so callers (frontend, nginx, ops) can correlate.
        response.headers[self.header_name] = request_id
        return response
