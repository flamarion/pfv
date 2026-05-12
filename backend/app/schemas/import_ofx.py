"""Pydantic schemas for the OFX transaction import flow (Wave 1 contract).

Frozen per spec at
``~/.claude/projects/-Users-fjorge-src-pfv/specs/2026-05-12-l3-2-import-contracts.md``.

These schemas extend (not replace) the existing CSV preview/confirm flow:
- The OFX preview endpoint returns ``ImportPreviewResponse`` (the CSV one),
  populating optional OFX-specific fields on each ``ImportPreviewRow``.
- The OFX confirm path reuses ``POST /api/v1/import/confirm`` — no new
  confirm schema needed; the OFX-specific fields ride on the same
  ``ImportConfirmRow`` shape (which is forward-compatible because the model
  uses ``extra="forbid"`` only for fields it knows about; new optional
  fields on ``ImportPreviewRow`` are echoed by the frontend into the
  confirm payload only if they're declared on ``ImportConfirmRow``).

Wave 2 OFX team owns the parser implementation; this file only freezes
the request/response wire shape.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


# ── OFX-specific row extras (echoed into ImportPreviewRow.fitid etc.) ──


class OFXRowExtras(BaseModel):
    """OFX-specific fields that ride on ``ImportPreviewRow``.

    None of these are required on the CSV path. The OFX parser populates
    them when the source is OFX; the frontend may echo them back into
    confirm-payload metadata for audit / future locale dispatch.

    Fields:
        fitid: Bank-side unique transaction id from ``<FITID>``. Per OFX
            spec §11.4.4, guaranteed unique within (bank_id, account).
            Used as the primary dedup signal for OFX imports — when
            present, takes precedence over the description/date/amount
            5-tuple key.
        bank_id: ``<BANKID>`` from ``<BANKACCTFROM>`` or ``<CCACCTFROM>``.
            Used for cross-account dedup scoping (an OFX from bank A and
            bank B with overlapping FITIDs is still two distinct streams).
        account_type_ofx: OFX ``<ACCTTYPE>`` value. One of:
            CHECKING, SAVINGS, CREDITLINE, MONEYMRKT. Informational only —
            does NOT auto-pick an ``AccountType`` (user already chose
            ``account_id`` at upload).
    """

    fitid: str | None = Field(default=None, max_length=128)
    bank_id: str | None = Field(default=None, max_length=64)
    account_type_ofx: Literal["CHECKING", "SAVINGS", "CREDITLINE", "MONEYMRKT"] | None = None

    model_config = ConfigDict(extra="forbid")


# ── Request envelope ──


class ImportOFXPreviewRequest(BaseModel):
    """OFX preview request (multipart form).

    Note: FastAPI handles multipart-form parsing via separate ``UploadFile``
    + ``Form()`` params on the route; this schema is included for OpenAPI
    documentation and contract testing only. The actual route signature
    uses ``file: UploadFile = File(...), account_id: int = Form(...)``.

    Fields:
        account_id: Target account for the import. Must belong to the
            current user's org.
    """

    account_id: int = Field(gt=0)

    model_config = ConfigDict(extra="forbid")


# ── Response envelope ──
# Note: actual response uses ``ImportPreviewResponse`` from
# ``app.schemas.import_schemas`` so OFX and CSV preview share a UI reducer.
# The Wave 2 OFX team adds ``fitid``, ``bank_id``, ``account_type_ofx`` to
# ``ImportPreviewRow`` (as nullable fields) when implementing the parser;
# this contract reserves those field names.


# ── Parser metadata response (diagnostic; optional Wave 2) ──


class OFXParseDiagnostics(BaseModel):
    """Diagnostic block returned alongside preview when an OFX file parses
    with non-fatal warnings (e.g., missing FITID, unusual TRNTYPE).

    Reserved for Wave 2 — not populated by the Wave 1 stub. Listed here so
    the frontend reducer can be coded once.

    Fields:
        ofx_version: Detected OFX version (e.g. "1.0.3", "2.0", "2.1.1").
        encoding: Detected file encoding.
        statement_count: Number of ``<STMTTRNRS>`` / ``<CCSTMTTRNRS>``
            blocks in the file. >1 means the file contains multiple
            accounts; only the matching ``account_id`` is imported.
        skipped_count: Rows skipped during parse (e.g., zero-amount
            transactions, malformed dates).
        warnings: Human-readable diagnostic strings (no PII).
    """

    ofx_version: str | None = None
    encoding: str | None = None
    statement_count: int = 0
    skipped_count: int = 0
    warnings: list[str] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")
