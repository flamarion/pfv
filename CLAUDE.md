# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PFV2 is a personal finance management application. FastAPI backend, Next.js + TypeScript frontend, MySQL database. Designed as a 12-factor app targeting Kubernetes for production.

## Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2.0 (async), Alembic, Pydantic v2
- **Frontend:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, SWR
- **Database:** MySQL 8.0
- **Auth:** JWT (access + refresh tokens), bcrypt via passlib
- **Dev environment:** Docker Compose

## Running Locally

```bash
cp .env.example .env              # First time only
docker compose up --build         # Start all services
docker compose exec backend alembic upgrade head  # Run migrations (first time / after new migrations)
```

- Frontend: http://localhost:3000
- Backend: http://localhost:8000
- API docs: http://localhost:8000/docs

## Common Commands

```bash
# Migrations
docker compose exec backend alembic upgrade head        # Apply all pending
docker compose exec backend alembic revision -m "description"  # Create new migration

# Logs
docker compose logs backend -f
docker compose logs frontend -f

# Rebuild after dependency changes
docker compose up --build -d backend
docker compose up --build -d frontend
```

## Architecture

```
frontend (Next.js :3000)  →  Bearer JWT  →  backend (FastAPI :8000)  →  MySQL (:3306)
```

All frontend-to-backend communication uses Bearer token authentication. No exceptions.

### Backend Structure

```
backend/app/
├── main.py          # FastAPI app, lifespan, CORS, router registration
├── config.py        # pydantic-settings, all config from env vars
├── database.py      # async SQLAlchemy engine + session factory
├── security.py      # JWT encode/decode, bcrypt hash/verify
├── deps.py          # FastAPI dependencies: get_db, get_current_user
├── logging.py       # structlog JSON setup
├── models/          # SQLAlchemy ORM models
├── schemas/         # Pydantic request/response models
└── routers/         # API route handlers
```

### Frontend Structure

```
frontend/
├── app/             # Next.js App Router pages
├── components/      # React components by feature
└── lib/
    ├── api.ts       # Typed fetch wrapper with Bearer token + silent refresh
    └── types.ts     # Shared TypeScript types
```

## Key Conventions

- **All config via env vars** — pydantic-settings in backend, NEXT_PUBLIC_ prefix in frontend
- **Stateless backend** — no in-memory state, no filesystem dependencies. Ready for horizontal scaling.
- **Migrations are explicit** — run `alembic upgrade head` manually, never on app startup
- **Org-scoped data** — all user data is scoped to an organization. Every query must filter by org_id.
- **Auth on every endpoint** — use `get_current_user` dependency. Only /health, /ready, /api/auth/login, /api/auth/register, /api/auth/refresh are public.
- **Enum values** — SQLAlchemy enums use `values_callable=lambda x: [e.value for e in x]` to store lowercase values in MySQL
