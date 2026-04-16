# P2 Billing & Subscription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mock billing & subscription system with plan management, 14-day trial, feature gating, trial banner, email notifications, and a unified Settings Hub — preparing the codebase for real payment integration later.

**Architecture:** Plans are data (not hardcoded enums) stored in a `plans` table, managed by superadmin via `/system/plans`. Each org gets a `Subscription` linking it to a plan with lifecycle states (trialing → active → canceled). Feature limits are defined per-plan and enforced via a middleware dependency. The existing `/admin/settings` and `/settings/security` pages are consolidated into a tabbed `/settings` hub with role-based tab visibility.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Alembic, Pydantic v2, Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS

---

## File Map

### Backend — New Files
| File | Responsibility |
|------|----------------|
| `backend/app/models/subscription.py` | Plan + Subscription SQLAlchemy models |
| `backend/app/schemas/subscription.py` | Pydantic request/response schemas |
| `backend/app/services/subscription_service.py` | Trial creation, plan changes, expiry check, enforcement |
| `backend/app/routers/subscriptions.py` | Org billing endpoints (`/api/v1/subscriptions`) |
| `backend/app/routers/plans.py` | Superadmin plan CRUD (`/api/v1/plans`) |
| `backend/alembic/versions/023_plans_and_subscriptions.py` | Migration: plans + subscriptions tables + seed data |

### Backend — Modified Files
| File | Change |
|------|--------|
| `backend/app/models/__init__.py` | Export Plan, Subscription, SubscriptionStatus |
| `backend/app/main.py` | Register subscriptions + plans routers |
| `backend/app/routers/auth.py` | Create trial subscription on org registration |
| `backend/app/config.py` | Add `default_plan_slug` + `trial_duration_days` settings |
| `backend/app/schemas/auth.py` | Add subscription fields to UserResponse |
| `backend/app/services/email_service.py` | Add trial expiring email template |
| `backend/.env.example` | Add new env vars |

### Frontend — New Files
| File | Responsibility |
|------|----------------|
| `frontend/app/settings/page.tsx` | Settings Hub with tabbed navigation |
| `frontend/app/settings/organization/page.tsx` | Organization tab (migrated from admin/settings) |
| `frontend/app/settings/billing/page.tsx` | Billing tab (new — plan view, upgrade/downgrade) |
| `frontend/app/settings/profile/page.tsx` | Profile tab (redirect to existing /profile) |
| `frontend/app/system/plans/page.tsx` | Superadmin plan management CRUD |
| `frontend/components/ui/TrialBanner.tsx` | Header trial/subscription status banner |

### Frontend — Modified Files
| File | Change |
|------|--------|
| `frontend/lib/types.ts` | Add Plan, Subscription, SubscriptionStatus interfaces |
| `frontend/lib/auth.ts` | Add `isOwner()` and `isSuperadmin()` helpers |
| `frontend/components/AppShell.tsx` | Replace Admin section with Settings link; add System section for superadmin; add TrialBanner to header |
| `frontend/components/auth/AuthProvider.tsx` | Add subscription data to user context |
| `frontend/app/admin/settings/page.tsx` | Redirect to /settings/organization |

---

## Task 1: Backend Data Model — Plan and Subscription

**Files:**
- Create: `backend/app/models/subscription.py`
- Modify: `backend/app/models/__init__.py`

- [ ] **Step 1: Create the Plan and Subscription models**

Create `backend/app/models/subscription.py`:

```python
import enum
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class SubscriptionStatus(str, enum.Enum):
    TRIALING = "trialing"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"


class BillingInterval(str, enum.Enum):
    MONTHLY = "monthly"
    YEARLY = "yearly"


class Plan(Base):
    __tablename__ = "plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_custom: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Pricing
    price_monthly: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=0
    )
    price_yearly: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=0
    )

    # Feature limits — null means unlimited
    max_users: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    retention_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    ai_budget_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    ai_forecast_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    ai_smart_plan_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    subscriptions: Mapped[list["Subscription"]] = relationship(back_populates="plan")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("organizations.id"), unique=True, nullable=False
    )
    plan_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("plans.id"), nullable=False
    )
    status: Mapped[SubscriptionStatus] = mapped_column(
        Enum(SubscriptionStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=SubscriptionStatus.TRIALING,
    )
    billing_interval: Mapped[BillingInterval] = mapped_column(
        Enum(BillingInterval, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=BillingInterval.MONTHLY,
    )

    # Trial tracking
    trial_start: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    trial_end: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Current paid period (null until first real payment)
    current_period_start: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    current_period_end: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    plan: Mapped["Plan"] = relationship(back_populates="subscriptions")
```

- [ ] **Step 2: Export new models from `__init__.py`**

Add to `backend/app/models/__init__.py` after line 9 (`from app.models.forecast_plan import ...`):

```python
from app.models.subscription import Plan, Subscription, SubscriptionStatus, BillingInterval
```

And add to the `__all__` list:

```python
    "Plan",
    "Subscription",
    "SubscriptionStatus",
    "BillingInterval",
```

- [ ] **Step 3: Verify models import cleanly**

Run: `cd /Users/fjorge/src/pfv && docker compose exec backend python -c "from app.models import Plan, Subscription, SubscriptionStatus; print('OK')"`

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/models/subscription.py backend/app/models/__init__.py
git commit -m "feat(billing): add Plan and Subscription SQLAlchemy models"
```

---

## Task 2: Alembic Migration — Plans and Subscriptions Tables

**Files:**
- Create: `backend/alembic/versions/023_plans_and_subscriptions.py`

- [ ] **Step 1: Create the migration file**

Create `backend/alembic/versions/023_plans_and_subscriptions.py`:

```python
"""plans and subscriptions

Revision ID: 023
Revises: 022
Create Date: 2026-04-16
"""

from alembic import op
import sqlalchemy as sa

revision = "023"
down_revision = "022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "plans",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("slug", sa.String(50), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_custom", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("price_monthly", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("price_yearly", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("max_users", sa.Integer(), nullable=True),
        sa.Column("retention_days", sa.Integer(), nullable=True),
        sa.Column("ai_budget_enabled", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("ai_forecast_enabled", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("ai_smart_plan_enabled", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )

    op.create_table(
        "subscriptions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("plan_id", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("trialing", "active", "past_due", "canceled", name="subscriptionstatus"),
            nullable=False,
            server_default="trialing",
        ),
        sa.Column(
            "billing_interval",
            sa.Enum("monthly", "yearly", name="billinginterval"),
            nullable=False,
            server_default="monthly",
        ),
        sa.Column("trial_start", sa.Date(), nullable=True),
        sa.Column("trial_end", sa.Date(), nullable=True),
        sa.Column("current_period_start", sa.Date(), nullable=True),
        sa.Column("current_period_end", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["plan_id"], ["plans.id"]),
        sa.UniqueConstraint("org_id"),
    )

    # Seed default plans
    plans_table = sa.table(
        "plans",
        sa.column("name", sa.String),
        sa.column("slug", sa.String),
        sa.column("description", sa.Text),
        sa.column("price_monthly", sa.Numeric),
        sa.column("price_yearly", sa.Numeric),
        sa.column("max_users", sa.Integer),
        sa.column("retention_days", sa.Integer),
        sa.column("ai_budget_enabled", sa.Boolean),
        sa.column("ai_forecast_enabled", sa.Boolean),
        sa.column("ai_smart_plan_enabled", sa.Boolean),
        sa.column("sort_order", sa.Integer),
    )
    op.bulk_insert(
        plans_table,
        [
            {
                "name": "Free",
                "slug": "free",
                "description": "Basic personal finance tracking",
                "price_monthly": 0,
                "price_yearly": 0,
                "max_users": 1,
                "retention_days": 180,
                "ai_budget_enabled": True,
                "ai_forecast_enabled": False,
                "ai_smart_plan_enabled": False,
                "sort_order": 0,
            },
            {
                "name": "Pro",
                "slug": "pro",
                "description": "Full-featured finance management for households",
                "price_monthly": 9.99,
                "price_yearly": 95.88,
                "max_users": 5,
                "retention_days": None,  # unlimited
                "ai_budget_enabled": True,
                "ai_forecast_enabled": True,
                "ai_smart_plan_enabled": True,
                "sort_order": 1,
            },
        ],
    )


def downgrade() -> None:
    op.drop_table("subscriptions")
    op.drop_table("plans")
```

- [ ] **Step 2: Run the migration**

Run: `cd /Users/fjorge/src/pfv && docker compose exec backend alembic upgrade head`

Expected: `INFO  [alembic.runtime.migration] Running upgrade 022 -> 023, plans and subscriptions`

- [ ] **Step 3: Verify tables and seed data exist**

Run: `cd /Users/fjorge/src/pfv && docker compose exec backend python -c "
import asyncio
from app.database import async_session
from sqlalchemy import select, text
async def check():
    async with async_session() as db:
        r = await db.execute(text('SELECT slug, name, max_users FROM plans ORDER BY sort_order'))
        for row in r.all():
            print(row)
asyncio.run(check())
"`

Expected:
```
('free', 'Free', 1)
('pro', 'Pro', 5)
```

- [ ] **Step 4: Commit**

```bash
git add backend/alembic/versions/023_plans_and_subscriptions.py
git commit -m "feat(billing): add plans and subscriptions migration with seed data"
```

---

## Task 3: Backend Config — Billing Settings

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/.env.example`

- [ ] **Step 1: Add billing config to Settings class**

In `backend/app/config.py`, add after the CORS section (after line 41, before the `@property`):

```python
    # Billing
    default_plan_slug: str = "pro"  # "pro" during beta, "free" when billing goes live
    trial_duration_days: int = 14
```

- [ ] **Step 2: Add to .env.example**

Append to `backend/.env.example`:

```
# Billing
# DEFAULT_PLAN_SLUG=pro        # "pro" during beta, "free" when billing goes live
# TRIAL_DURATION_DAYS=14
```

- [ ] **Step 3: Verify config loads**

Run: `cd /Users/fjorge/src/pfv && docker compose exec backend python -c "from app.config import settings; print(settings.default_plan_slug, settings.trial_duration_days)"`

Expected: `pro 14`

- [ ] **Step 4: Commit**

```bash
git add backend/app/config.py backend/.env.example
git commit -m "feat(billing): add default_plan_slug and trial_duration_days config"
```

---

## Task 4: Subscription Service — Core Business Logic

**Files:**
- Create: `backend/app/services/subscription_service.py`

- [ ] **Step 1: Create the subscription service**

Create `backend/app/services/subscription_service.py`:

```python
"""Subscription service — trial lifecycle, plan changes, feature enforcement."""

import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.subscription import (
    BillingInterval,
    Plan,
    Subscription,
    SubscriptionStatus,
)
from app.models.user import User
from app.services.exceptions import NotFoundError, ValidationError


async def get_default_plan(db: AsyncSession) -> Plan:
    """Get the plan configured as the default for new orgs."""
    result = await db.execute(
        select(Plan).where(Plan.slug == settings.default_plan_slug, Plan.is_active == True)
    )
    plan = result.scalar_one_or_none()
    if plan is None:
        # Fallback to any active plan
        result = await db.execute(
            select(Plan).where(Plan.is_active == True).order_by(Plan.sort_order).limit(1)
        )
        plan = result.scalar_one_or_none()
    if plan is None:
        raise RuntimeError("No active plans configured — seed the database")
    return plan


async def create_trial(db: AsyncSession, org_id: int) -> Subscription:
    """Create a trial subscription for a new org."""
    plan = await get_default_plan(db)
    today = datetime.date.today()
    trial_end = today + datetime.timedelta(days=settings.trial_duration_days)

    subscription = Subscription(
        org_id=org_id,
        plan_id=plan.id,
        status=SubscriptionStatus.TRIALING,
        trial_start=today,
        trial_end=trial_end,
    )
    db.add(subscription)
    await db.flush()
    return subscription


async def get_subscription(db: AsyncSession, org_id: int) -> Subscription | None:
    """Get the subscription for an org, or None if not found."""
    result = await db.execute(
        select(Subscription).where(Subscription.org_id == org_id)
    )
    return result.scalar_one_or_none()


async def get_subscription_with_plan(
    db: AsyncSession, org_id: int
) -> tuple[Subscription, Plan] | None:
    """Get subscription + plan for an org."""
    result = await db.execute(
        select(Subscription, Plan)
        .join(Plan, Subscription.plan_id == Plan.id)
        .where(Subscription.org_id == org_id)
    )
    row = result.first()
    if row is None:
        return None
    return row[0], row[1]


async def check_trial_expiry(db: AsyncSession, org_id: int) -> Subscription | None:
    """Check if trial has expired and downgrade if needed. Returns updated subscription."""
    sub = await get_subscription(db, org_id)
    if sub is None:
        return None

    if sub.status != SubscriptionStatus.TRIALING:
        return sub

    if sub.trial_end and sub.trial_end < datetime.date.today():
        # Trial expired — downgrade to free plan
        free_plan = await db.execute(
            select(Plan).where(Plan.slug == "free", Plan.is_active == True)
        )
        free = free_plan.scalar_one_or_none()
        if free:
            sub.plan_id = free.id
        sub.status = SubscriptionStatus.ACTIVE
        sub.trial_start = None
        sub.trial_end = None
        await db.commit()
        await db.refresh(sub)

    return sub


async def change_plan(
    db: AsyncSession, org_id: int, plan_slug: str, billing_interval: str
) -> Subscription:
    """Change an org's plan. Instant switch."""
    result = await db.execute(
        select(Plan).where(Plan.slug == plan_slug, Plan.is_active == True)
    )
    new_plan = result.scalar_one_or_none()
    if new_plan is None:
        raise NotFoundError("Plan")

    sub = await get_subscription(db, org_id)
    if sub is None:
        raise NotFoundError("Subscription")

    # Validate billing interval
    try:
        interval = BillingInterval(billing_interval)
    except ValueError:
        raise ValidationError("Invalid billing interval — use 'monthly' or 'yearly'")

    sub.plan_id = new_plan.id
    sub.billing_interval = interval

    # If upgrading from trial, convert to active
    if sub.status == SubscriptionStatus.TRIALING:
        sub.status = SubscriptionStatus.ACTIVE
        sub.trial_start = None
        sub.trial_end = None
        # In mock mode, set a 30-day period
        today = datetime.date.today()
        sub.current_period_start = today
        if interval == BillingInterval.MONTHLY:
            sub.current_period_end = today + datetime.timedelta(days=30)
        else:
            sub.current_period_end = today + datetime.timedelta(days=365)

    # If changing plan on active subscription, keep current period
    # (real billing would prorate — mock just swaps)

    await db.commit()
    await db.refresh(sub)
    return sub


async def cancel_subscription(db: AsyncSession, org_id: int) -> Subscription:
    """Cancel subscription. Access continues until current period ends."""
    sub = await get_subscription(db, org_id)
    if sub is None:
        raise NotFoundError("Subscription")

    sub.status = SubscriptionStatus.CANCELED
    await db.commit()
    await db.refresh(sub)
    return sub


async def enforce_user_limit(db: AsyncSession, org_id: int) -> None:
    """Check if the org can add another user. Raises ValidationError if at limit."""
    pair = await get_subscription_with_plan(db, org_id)
    if pair is None:
        return  # No subscription = no limit (shouldn't happen)

    _, plan = pair
    if plan.max_users is None:
        return  # Unlimited

    user_count = await db.scalar(
        select(func.count()).select_from(User).where(
            User.org_id == org_id, User.is_active == True
        )
    )
    if user_count >= plan.max_users:
        raise ValidationError(
            f"Your plan ({plan.name}) allows a maximum of {plan.max_users} user(s). "
            "Upgrade your plan to add more users."
        )
```

- [ ] **Step 2: Verify service imports**

Run: `cd /Users/fjorge/src/pfv && docker compose exec backend python -c "from app.services import subscription_service; print('OK')"`

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/subscription_service.py
git commit -m "feat(billing): add subscription service with trial, plan change, and enforcement"
```

---

## Task 5: Pydantic Schemas — Subscription API Models

**Files:**
- Create: `backend/app/schemas/subscription.py`

- [ ] **Step 1: Create the subscription schemas**

Create `backend/app/schemas/subscription.py`:

```python
from decimal import Decimal

from pydantic import BaseModel, Field


class PlanResponse(BaseModel):
    id: int
    name: str
    slug: str
    description: str
    is_custom: bool
    is_active: bool
    sort_order: int
    price_monthly: Decimal
    price_yearly: Decimal
    max_users: int | None
    retention_days: int | None
    ai_budget_enabled: bool
    ai_forecast_enabled: bool
    ai_smart_plan_enabled: bool

    model_config = {"from_attributes": True}


class PlanCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    slug: str = Field(min_length=1, max_length=50, pattern=r"^[a-z0-9-]+$")
    description: str = ""
    is_custom: bool = False
    sort_order: int = 0
    price_monthly: Decimal = Field(ge=0, default=0)
    price_yearly: Decimal = Field(ge=0, default=0)
    max_users: int | None = Field(default=None, ge=1)
    retention_days: int | None = Field(default=None, ge=1)
    ai_budget_enabled: bool = False
    ai_forecast_enabled: bool = False
    ai_smart_plan_enabled: bool = False


class PlanUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None
    is_custom: bool | None = None
    is_active: bool | None = None
    sort_order: int | None = None
    price_monthly: Decimal | None = Field(default=None, ge=0)
    price_yearly: Decimal | None = Field(default=None, ge=0)
    max_users: int | None = None
    retention_days: int | None = None
    ai_budget_enabled: bool | None = None
    ai_forecast_enabled: bool | None = None
    ai_smart_plan_enabled: bool | None = None


class SubscriptionResponse(BaseModel):
    id: int
    org_id: int
    plan: PlanResponse
    status: str
    billing_interval: str
    trial_start: str | None
    trial_end: str | None
    current_period_start: str | None
    current_period_end: str | None

    model_config = {"from_attributes": True}


class ChangePlanRequest(BaseModel):
    plan_slug: str = Field(min_length=1, max_length=50)
    billing_interval: str = Field(default="monthly", pattern=r"^(monthly|yearly)$")
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/schemas/subscription.py
git commit -m "feat(billing): add Pydantic schemas for plans and subscriptions"
```

---

## Task 6: Subscription Router — Org Billing Endpoints

**Files:**
- Create: `backend/app/routers/subscriptions.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create the subscriptions router**

Create `backend/app/routers/subscriptions.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models.user import Role, User
from app.schemas.subscription import ChangePlanRequest, SubscriptionResponse
from app.services import subscription_service

router = APIRouter(prefix="/api/v1/subscriptions", tags=["subscriptions"])


def _require_owner(user: User) -> None:
    if user.role != Role.OWNER and not user.is_superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the organization owner can manage billing",
        )


def _sub_response(sub, plan) -> dict:
    return {
        "id": sub.id,
        "org_id": sub.org_id,
        "plan": {
            "id": plan.id,
            "name": plan.name,
            "slug": plan.slug,
            "description": plan.description,
            "is_custom": plan.is_custom,
            "is_active": plan.is_active,
            "sort_order": plan.sort_order,
            "price_monthly": float(plan.price_monthly),
            "price_yearly": float(plan.price_yearly),
            "max_users": plan.max_users,
            "retention_days": plan.retention_days,
            "ai_budget_enabled": plan.ai_budget_enabled,
            "ai_forecast_enabled": plan.ai_forecast_enabled,
            "ai_smart_plan_enabled": plan.ai_smart_plan_enabled,
        },
        "status": sub.status.value,
        "billing_interval": sub.billing_interval.value,
        "trial_start": sub.trial_start.isoformat() if sub.trial_start else None,
        "trial_end": sub.trial_end.isoformat() if sub.trial_end else None,
        "current_period_start": sub.current_period_start.isoformat() if sub.current_period_start else None,
        "current_period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
    }


@router.get("")
async def get_subscription(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the current org's subscription. Any authenticated user can view."""
    # Check trial expiry on every fetch
    await subscription_service.check_trial_expiry(db, current_user.org_id)

    pair = await subscription_service.get_subscription_with_plan(db, current_user.org_id)
    if pair is None:
        raise HTTPException(status_code=404, detail="No subscription found")
    sub, plan = pair
    return _sub_response(sub, plan)


@router.put("/plan")
async def change_plan(
    body: ChangePlanRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Change the org's plan. Owner only."""
    _require_owner(current_user)
    sub = await subscription_service.change_plan(
        db, current_user.org_id, body.plan_slug, body.billing_interval
    )
    pair = await subscription_service.get_subscription_with_plan(db, current_user.org_id)
    sub, plan = pair
    return _sub_response(sub, plan)


@router.post("/cancel")
async def cancel_subscription(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cancel the subscription. Owner only. Access continues until period end."""
    _require_owner(current_user)
    sub = await subscription_service.cancel_subscription(db, current_user.org_id)
    pair = await subscription_service.get_subscription_with_plan(db, current_user.org_id)
    sub, plan = pair
    return _sub_response(sub, plan)
```

- [ ] **Step 2: Register router in main.py**

In `backend/app/main.py`, add to the imports (line 16):

```python
from app.routers import account_types, accounts, auth, budgets, categories, forecast, forecast_plans, import_router, recurring, settings, subscriptions, transactions, users
```

And add after line 88 (`app.include_router(import_router.router)`):

```python
app.include_router(subscriptions.router)
```

- [ ] **Step 3: Verify router registers**

Run: `cd /Users/fjorge/src/pfv && docker compose exec backend python -c "from app.main import app; routes = [r.path for r in app.routes]; print([r for r in routes if 'subscription' in r])"`

Expected: `['/api/v1/subscriptions', '/api/v1/subscriptions/plan', '/api/v1/subscriptions/cancel']`

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/subscriptions.py backend/app/main.py
git commit -m "feat(billing): add subscription endpoints — get, change plan, cancel"
```

---

## Task 7: Plans Router — Superadmin CRUD

**Files:**
- Create: `backend/app/routers/plans.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create the plans router**

Create `backend/app/routers/plans.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models.subscription import Plan, Subscription
from app.models.user import User
from app.schemas.subscription import PlanCreate, PlanResponse, PlanUpdate

router = APIRouter(prefix="/api/v1/plans", tags=["plans"])


def _require_superadmin(user: User) -> None:
    if not user.is_superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Superadmin access required",
        )


@router.get("", response_model=list[PlanResponse])
async def list_plans(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all plans. Any authenticated user can view (for plan selection UI)."""
    result = await db.execute(
        select(Plan).where(Plan.is_active == True).order_by(Plan.sort_order)
    )
    return result.scalars().all()


@router.get("/all", response_model=list[PlanResponse])
async def list_all_plans(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all plans including inactive. Superadmin only."""
    _require_superadmin(current_user)
    result = await db.execute(select(Plan).order_by(Plan.sort_order))
    return result.scalars().all()


@router.get("/{plan_id}")
async def get_plan(
    plan_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single plan with org count. Superadmin only."""
    _require_superadmin(current_user)
    result = await db.execute(select(Plan).where(Plan.id == plan_id))
    plan = result.scalar_one_or_none()
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan not found")

    org_count = await db.scalar(
        select(func.count()).select_from(Subscription).where(
            Subscription.plan_id == plan_id
        )
    )

    return {
        **PlanResponse.model_validate(plan).model_dump(),
        "org_count": org_count,
    }


@router.post("", response_model=PlanResponse, status_code=201)
async def create_plan(
    body: PlanCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new plan. Superadmin only."""
    _require_superadmin(current_user)

    existing = await db.execute(select(Plan).where(Plan.slug == body.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Plan slug already exists")

    plan = Plan(**body.model_dump())
    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return plan


@router.put("/{plan_id}", response_model=PlanResponse)
async def update_plan(
    plan_id: int,
    body: PlanUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a plan. Superadmin only."""
    _require_superadmin(current_user)

    result = await db.execute(select(Plan).where(Plan.id == plan_id))
    plan = result.scalar_one_or_none()
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(plan, field, value)

    await db.commit()
    await db.refresh(plan)
    return plan


@router.delete("/{plan_id}", status_code=204)
async def delete_plan(
    plan_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete (deactivate) a plan. Superadmin only. Cannot delete if orgs are on it."""
    _require_superadmin(current_user)

    result = await db.execute(select(Plan).where(Plan.id == plan_id))
    plan = result.scalar_one_or_none()
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan not found")

    org_count = await db.scalar(
        select(func.count()).select_from(Subscription).where(
            Subscription.plan_id == plan_id
        )
    )
    if org_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete plan — {org_count} organization(s) are currently on it",
        )

    plan.is_active = False
    await db.commit()
```

- [ ] **Step 2: Register plans router in main.py**

In `backend/app/main.py`, update the import to include `plans`:

```python
from app.routers import account_types, accounts, auth, budgets, categories, forecast, forecast_plans, import_router, plans, recurring, settings, subscriptions, transactions, users
```

And add after the subscriptions router:

```python
app.include_router(plans.router)
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/plans.py backend/app/main.py
git commit -m "feat(billing): add superadmin plan CRUD endpoints"
```

---

## Task 8: Hook Trial Creation into Registration

**Files:**
- Modify: `backend/app/routers/auth.py`
- Modify: `backend/app/schemas/auth.py`

- [ ] **Step 1: Create trial on registration**

In `backend/app/routers/auth.py`, add an import near the top (around line 15):

```python
from app.services import subscription_service
```

In the `register` function, add after `await db.refresh(org)` (line 219) and before the verification email line:

```python
    # Create trial subscription for the new org
    await subscription_service.create_trial(db, org.id)
```

- [ ] **Step 2: Add subscription info to UserResponse**

In `backend/app/schemas/auth.py`, add after the `mfa_enabled` field (line 43):

```python
    subscription_status: str | None = None
    subscription_plan: str | None = None
    trial_end: str | None = None
```

- [ ] **Step 3: Update _user_response to include subscription data**

In `backend/app/routers/auth.py`, update the `_user_response` function. Add an import at the top:

```python
from app.models.subscription import Subscription, Plan
```

Change `_user_response` to accept an optional subscription parameter:

```python
def _user_response(user: User, org: Organization, sub: Subscription | None = None, plan: Plan | None = None) -> UserResponse:
    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        phone=user.phone,
        avatar_url=user.avatar_url,
        email_verified=user.email_verified,
        role=user.role.value,
        org_id=org.id,
        org_name=org.name,
        billing_cycle_day=org.billing_cycle_day,
        is_superadmin=user.is_superadmin,
        is_active=user.is_active,
        mfa_enabled=user.mfa_enabled,
        subscription_status=sub.status.value if sub else None,
        subscription_plan=plan.slug if plan else None,
        trial_end=sub.trial_end.isoformat() if sub and sub.trial_end else None,
    )
```

- [ ] **Step 4: Update /auth/me to include subscription data**

Find the `/auth/me` endpoint in `auth.py` and update it to fetch subscription data. Locate the endpoint and add before the return:

```python
    pair = await subscription_service.get_subscription_with_plan(db, current_user.org_id)
    sub, plan = pair if pair else (None, None)
```

And update the return to pass `sub` and `plan`:

```python
    return _user_response(current_user, org, sub, plan)
```

- [ ] **Step 5: Verify registration creates trial**

Run: `cd /Users/fjorge/src/pfv && docker compose exec backend python -c "
import asyncio
from app.database import async_session
from sqlalchemy import select, text
async def check():
    async with async_session() as db:
        r = await db.execute(text('SELECT s.org_id, s.status, p.slug FROM subscriptions s JOIN plans p ON s.plan_id = p.id'))
        for row in r.all():
            print(row)
asyncio.run(check())
"`

Expected: shows existing org subscriptions (may be empty if no orgs exist yet — that's fine, new registrations will create them)

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/auth.py backend/app/schemas/auth.py
git commit -m "feat(billing): create trial subscription on registration, add to user response"
```

---

## Task 9: Trial Expiry Email Notification

**Files:**
- Modify: `backend/app/services/email_service.py`

- [ ] **Step 1: Add trial expiring email template**

In `backend/app/services/email_service.py`, add after the `send_verification_email` function:

```python
async def send_trial_expiring_email(to: str, days_left: int, org_name: str) -> bool:
    """Send a trial expiring notification."""
    upgrade_url = f"{settings.app_url}/settings/billing"
    subject = f"PFV2 — Your trial ends in {days_left} day{'s' if days_left != 1 else ''}"
    body_html = f"""
    <h2>Your Trial Is Ending Soon</h2>
    <p>Hi! Your <strong>{org_name}</strong> trial ends in <strong>{days_left} day{'s' if days_left != 1 else ''}</strong>.</p>
    <p>After the trial, your account will switch to the Free plan with limited features.</p>
    <p><a href="{upgrade_url}">Upgrade to Pro</a> to keep all your features.</p>
    <p style="color: #666; font-size: 12px;">No charge will be applied during beta — upgrading simply reserves your spot.</p>
    """
    body_text = (
        f"Your {org_name} trial ends in {days_left} day{'s' if days_left != 1 else ''}.\n"
        f"Upgrade at: {upgrade_url}\n"
        "No charge during beta."
    )
    return await send_email(to, subject, body_html, body_text)
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/email_service.py
git commit -m "feat(billing): add trial expiring email template"
```

---

## Task 10: Frontend Types — Plan and Subscription

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/lib/auth.ts`

- [ ] **Step 1: Add subscription types to types.ts**

Add at the end of `frontend/lib/types.ts`:

```typescript
export interface Plan {
  id: number;
  name: string;
  slug: string;
  description: string;
  is_custom: boolean;
  is_active: boolean;
  sort_order: number;
  price_monthly: number;
  price_yearly: number;
  max_users: number | null;
  retention_days: number | null;
  ai_budget_enabled: boolean;
  ai_forecast_enabled: boolean;
  ai_smart_plan_enabled: boolean;
}

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";

export interface SubscriptionDetail {
  id: number;
  org_id: number;
  plan: Plan;
  status: SubscriptionStatus;
  billing_interval: "monthly" | "yearly";
  trial_start: string | null;
  trial_end: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
}
```

- [ ] **Step 2: Add subscription fields to User interface**

In `frontend/lib/types.ts`, add to the `User` interface after `mfa_enabled: boolean;`:

```typescript
  subscription_status: SubscriptionStatus | null;
  subscription_plan: string | null;
  trial_end: string | null;
```

- [ ] **Step 3: Add role helpers to auth.ts**

Replace the content of `frontend/lib/auth.ts`:

```typescript
import type { User } from "@/lib/types";

export function isAdmin(user: User): boolean {
  return user.role === "owner" || user.role === "admin" || user.is_superadmin;
}

export function isOwner(user: User): boolean {
  return user.role === "owner" || user.is_superadmin;
}

export function isSuperadmin(user: User): boolean {
  return user.is_superadmin;
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/auth.ts
git commit -m "feat(billing): add Plan, Subscription types and role helpers"
```

---

## Task 11: Trial Banner Component

**Files:**
- Create: `frontend/components/ui/TrialBanner.tsx`
- Modify: `frontend/components/AppShell.tsx`

- [ ] **Step 1: Create the TrialBanner component**

Create `frontend/components/ui/TrialBanner.tsx`:

```typescript
"use client";

import Link from "next/link";
import type { User } from "@/lib/types";

interface Props {
  user: User;
}

export default function TrialBanner({ user }: Props) {
  const { subscription_status, subscription_plan, trial_end } = user;

  if (!subscription_status) return null;

  // Calculate days left for trial
  let daysLeft = 0;
  if (subscription_status === "trialing" && trial_end) {
    const end = new Date(trial_end + "T23:59:59");
    const now = new Date();
    daysLeft = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  }

  // Trial active — plenty of time
  if (subscription_status === "trialing" && daysLeft > 3) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-3 py-1">
        <span className="text-xs font-medium text-accent">Pro Trial</span>
        <span className="text-[11px] text-accent/70">{daysLeft} days left</span>
      </div>
    );
  }

  // Trial expiring — urgent
  if (subscription_status === "trialing" && daysLeft <= 3) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1">
        <span className="text-xs font-medium text-amber-400">Trial ending</span>
        <span className="text-[11px] text-amber-300">
          {daysLeft === 0 ? "today" : `${daysLeft} day${daysLeft !== 1 ? "s" : ""} left`}
        </span>
        <Link
          href="/settings/billing"
          className="text-[11px] font-medium text-amber-400 underline hover:text-amber-300"
        >
          Upgrade
        </Link>
      </div>
    );
  }

  // Free plan — show upgrade nudge
  if (subscription_plan === "free") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface-raised px-3 py-1">
        <span className="text-xs text-text-muted">Free Plan</span>
        <Link
          href="/settings/billing"
          className="text-[11px] font-medium text-accent underline hover:text-accent-hover"
        >
          Upgrade
        </Link>
      </div>
    );
  }

  // Active paid plan — no banner needed
  return null;
}
```

- [ ] **Step 2: Add TrialBanner to AppShell header**

In `frontend/components/AppShell.tsx`, add the import after the ThemeToggle import (line 7):

```typescript
import TrialBanner from "@/components/ui/TrialBanner";
```

Replace the header section (lines 248-256) with:

```typescript
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4 sm:px-8">
          <button onClick={() => setSidebarOpen(true)} className="rounded-md p-2 text-text-muted hover:text-text-primary lg:hidden" aria-label="Open menu">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <div className="lg:hidden" />
          <div className="flex items-center gap-3">
            <TrialBanner user={user} />
            <ThemeToggle />
          </div>
        </header>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/components/ui/TrialBanner.tsx frontend/components/AppShell.tsx
git commit -m "feat(billing): add trial banner to app header"
```

---

## Task 12: Sidebar Restructure — Settings Hub + System Section

**Files:**
- Modify: `frontend/components/AppShell.tsx`

- [ ] **Step 1: Update sidebar navigation**

In `frontend/components/AppShell.tsx`, add the `isSuperadmin` import:

```typescript
import { isAdmin as checkAdmin, isSuperadmin as checkSuperadmin } from "@/lib/auth";
```

Replace the `adminItems` array (lines 78-89) with:

```typescript
const adminItems = [
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      </svg>
    ),
  },
];

const systemItems = [
  {
    href: "/system/plans",
    label: "Plans",
    icon: (
      <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
      </svg>
    ),
  },
];
```

Add `const superadmin = checkSuperadmin(user);` after `const admin = checkAdmin(user);` (line 117).

Then update the admin/system nav section (replace the `{admin && (...)}` block, lines 160-183) with:

```typescript
          {admin && (
            <>
              <div className="pb-1 pt-6 px-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-muted">
                  Admin
                </span>
              </div>
              {adminItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors ${
                    isActive(item.href)
                      ? "bg-sidebar-active-bg text-sidebar-active-text"
                      : "text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-bright"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </Link>
              ))}
            </>
          )}

          {superadmin && (
            <>
              <div className="pb-1 pt-6 px-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-muted">
                  System
                </span>
              </div>
              {systemItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors ${
                    isActive(item.href)
                      ? "bg-sidebar-active-bg text-sidebar-active-text"
                      : "text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-bright"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </Link>
              ))}
            </>
          )}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/AppShell.tsx
git commit -m "feat(billing): restructure sidebar — Settings link, System section for superadmin"
```

---

## Task 13: Settings Hub — Tabbed Navigation Page

**Files:**
- Create: `frontend/app/settings/page.tsx`
- Create: `frontend/app/settings/organization/page.tsx`
- Create: `frontend/app/settings/profile/page.tsx`
- Modify: `frontend/app/admin/settings/page.tsx`

- [ ] **Step 1: Create the Settings Hub page**

Create `frontend/app/settings/page.tsx`:

```typescript
"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/components/auth/AuthProvider";
import { isAdmin, isOwner } from "@/lib/auth";
import { pageTitle } from "@/lib/styles";

const tabs = [
  { href: "/settings", label: "Profile", minRole: "member" as const },
  { href: "/settings/security", label: "Security", minRole: "member" as const },
  { href: "/settings/organization", label: "Organization", minRole: "admin" as const },
  { href: "/settings/billing", label: "Billing", minRole: "owner" as const },
];

function SettingsLayout({ children, activeTab }: { children: React.ReactNode; activeTab: string }) {
  const { user } = useAuth();
  if (!user) return null;

  const visibleTabs = tabs.filter((tab) => {
    if (tab.minRole === "owner") return isOwner(user);
    if (tab.minRole === "admin") return isAdmin(user);
    return true;
  });

  return (
    <AppShell>
      <h1 className={pageTitle}>Settings</h1>
      <div className="mb-6 flex gap-0 border-b border-border">
        {visibleTabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-5 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.href
                ? "border-b-2 border-accent text-accent"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      {children}
    </AppShell>
  );
}

export { SettingsLayout };

export default function SettingsProfilePage() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Redirect to the existing profile page content inline
    // For now, redirect to /profile — will be consolidated later
    if (user) router.replace("/profile");
  }, [user, router]);

  return null;
}
```

- [ ] **Step 2: Create Organization settings tab**

Create `frontend/app/settings/organization/page.tsx`:

```typescript
"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SettingsLayout } from "@/app/settings/page";
import Spinner from "@/components/ui/Spinner";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiFetch, extractErrorMessage } from "@/lib/api";
import { isAdmin } from "@/lib/auth";
import {
  input,
  label,
  btnPrimary,
  card,
  cardHeader,
  cardTitle,
  error as errorCls,
  success as successCls,
} from "@/lib/styles";
import type { OrgSetting } from "@/lib/types";

export default function OrganizationSettingsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [settings, setSettings] = useState<OrgSetting[]>([]);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    variant: "warning" | "danger";
    action: () => void;
  } | null>(null);
  const [billingCycleDay, setBillingCycleDay] = useState(user?.billing_cycle_day ?? 1);
  const [savingCycle, setSavingCycle] = useState(false);
  const [currentPeriod, setCurrentPeriod] = useState<{
    id: number;
    start_date: string;
    end_date: string | null;
  } | null>(null);
  const [closingPeriod, setClosingPeriod] = useState(false);

  const admin = user ? isAdmin(user) : false;

  useEffect(() => {
    if (!loading && !admin) router.replace("/settings");
  }, [loading, admin, router]);

  const reload = useCallback(async () => {
    try {
      const data = await apiFetch<OrgSetting[]>("/api/v1/settings");
      setSettings(data);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (admin) {
      reload();
      apiFetch<{ id: number; start_date: string; end_date: string | null }>(
        "/api/v1/settings/billing-period"
      ).then(setCurrentPeriod).catch(() => {});
    }
  }, [admin, reload]);

  async function handleSaveCycle(e: FormEvent) {
    e.preventDefault();
    setSavingCycle(true);
    setError("");
    try {
      await apiFetch("/api/v1/settings/billing-cycle", {
        method: "PUT",
        body: JSON.stringify({ billing_cycle_day: billingCycleDay }),
      });
      setSuccessMsg("Billing cycle updated");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSavingCycle(false);
    }
  }

  function handleClosePeriod() {
    setConfirmAction({
      title: "Close Billing Period",
      message: `Close the current billing period starting ${currentPeriod?.start_date}?\nA new period will open automatically.`,
      variant: "warning",
      action: async () => {
        setClosingPeriod(true);
        try {
          await apiFetch("/api/v1/settings/billing-period/close", { method: "POST" });
          const p = await apiFetch<{ id: number; start_date: string; end_date: string | null }>(
            "/api/v1/settings/billing-period"
          );
          setCurrentPeriod(p);
          setSuccessMsg("Period closed");
          setTimeout(() => setSuccessMsg(""), 3000);
        } catch (err) {
          setError(extractErrorMessage(err));
        } finally {
          setClosingPeriod(false);
        }
      },
    });
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await apiFetch("/api/v1/settings", {
        method: "PUT",
        body: JSON.stringify({ key, value }),
      });
      setKey("");
      setValue("");
      await reload();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  async function handleUpdate(settingKey: string) {
    setError("");
    try {
      await apiFetch("/api/v1/settings", {
        method: "PUT",
        body: JSON.stringify({ key: settingKey, value: editingValue }),
      });
      setEditingKey(null);
      await reload();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  async function handleDelete(settingKey: string) {
    setConfirmAction({
      title: "Delete Setting",
      message: `Delete setting "${settingKey}"?`,
      variant: "danger",
      action: async () => {
        setError("");
        try {
          await apiFetch(`/api/v1/settings/${encodeURIComponent(settingKey)}`, {
            method: "DELETE",
          });
          await reload();
        } catch (err) {
          setError(extractErrorMessage(err));
        }
      },
    });
  }

  if (loading || !user || !admin) {
    return (
      <SettingsLayout activeTab="/settings/organization">
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout activeTab="/settings/organization">
      {error && <p className={errorCls}>{error}</p>}
      {successMsg && <p className={successCls}>{successMsg}</p>}

      <div className="space-y-6">
        {/* Organization Name */}
        <div className={card}>
          <div className={cardHeader}>
            <h2 className={cardTitle}>Organization</h2>
          </div>
          <div className="p-6">
            <p className="text-sm text-text-secondary">{user.org_name}</p>
          </div>
        </div>

        {/* Billing Period */}
        <div className={card}>
          <div className={cardHeader}>
            <h2 className={cardTitle}>Billing Period</h2>
          </div>
          <div className="p-6 space-y-4">
            {currentPeriod && (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-primary">
                    Current: {currentPeriod.start_date} — {currentPeriod.end_date ?? "open"}
                  </p>
                  <p className="text-xs text-text-muted">
                    {currentPeriod.end_date ? "Closed" : "Open — transactions are being recorded"}
                  </p>
                </div>
                {!currentPeriod.end_date && (
                  <button
                    onClick={handleClosePeriod}
                    disabled={closingPeriod}
                    className={btnPrimary}
                  >
                    {closingPeriod ? "Closing..." : "Close Period"}
                  </button>
                )}
              </div>
            )}

            <form onSubmit={handleSaveCycle} className="flex items-end gap-3">
              <div>
                <label className={label}>Billing cycle day</label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={billingCycleDay}
                  onChange={(e) => setBillingCycleDay(Number(e.target.value))}
                  className={`${input} w-24`}
                />
              </div>
              <button type="submit" disabled={savingCycle} className={btnPrimary}>
                {savingCycle ? "Saving..." : "Save"}
              </button>
            </form>
          </div>
        </div>

        {/* Advanced Configuration */}
        <div className={card}>
          <div className={cardHeader}>
            <h2 className={cardTitle}>Advanced Configuration</h2>
          </div>
          <div className="p-6 space-y-4">
            <form onSubmit={handleAdd} className="flex items-end gap-3">
              <div>
                <label className={label}>Key</label>
                <input value={key} onChange={(e) => setKey(e.target.value)} className={input} placeholder="key" />
              </div>
              <div>
                <label className={label}>Value</label>
                <input value={value} onChange={(e) => setValue(e.target.value)} className={input} placeholder="value" />
              </div>
              <button type="submit" className={btnPrimary}>Add</button>
            </form>

            {settings.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-text-muted">
                    <th className="pb-2">Key</th>
                    <th className="pb-2">Value</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {settings.map((s) => (
                    <tr key={s.key} className="border-b border-border">
                      <td className="py-2 text-text-primary">{s.key}</td>
                      <td className="py-2">
                        {editingKey === s.key ? (
                          <input
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleUpdate(s.key)}
                            className={`${input} w-48`}
                            autoFocus
                          />
                        ) : (
                          <span className="text-text-secondary">{s.value}</span>
                        )}
                      </td>
                      <td className="py-2 text-right space-x-2">
                        {editingKey === s.key ? (
                          <>
                            <button onClick={() => handleUpdate(s.key)} className="text-xs text-accent hover:underline">Save</button>
                            <button onClick={() => setEditingKey(null)} className="text-xs text-text-muted hover:underline">Cancel</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => { setEditingKey(s.key); setEditingValue(s.value); }} className="text-xs text-accent hover:underline">Edit</button>
                            <button onClick={() => handleDelete(s.key)} className="text-xs text-danger hover:underline">Delete</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        open={!!confirmAction}
        title={confirmAction?.title ?? ""}
        message={confirmAction?.message ?? ""}
        variant={confirmAction?.variant ?? "warning"}
        onConfirm={() => {
          confirmAction?.action();
          setConfirmAction(null);
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </SettingsLayout>
  );
}
```

- [ ] **Step 3: Create profile redirect page**

Create `frontend/app/settings/profile/page.tsx`:

```typescript
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SettingsProfileRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/profile");
  }, [router]);
  return null;
}
```

- [ ] **Step 4: Redirect old admin/settings to new location**

Replace the content of `frontend/app/admin/settings/page.tsx` with:

```typescript
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminSettingsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings/organization");
  }, [router]);
  return null;
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/app/settings/page.tsx frontend/app/settings/organization/page.tsx frontend/app/settings/profile/page.tsx frontend/app/admin/settings/page.tsx
git commit -m "feat(billing): add Settings Hub with tabs, migrate org settings"
```

---

## Task 14: Billing Settings Page

**Files:**
- Create: `frontend/app/settings/billing/page.tsx`

- [ ] **Step 1: Create the billing page**

Create `frontend/app/settings/billing/page.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SettingsLayout } from "@/app/settings/page";
import Spinner from "@/components/ui/Spinner";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiFetch, extractErrorMessage } from "@/lib/api";
import { isOwner } from "@/lib/auth";
import {
  btnPrimary,
  btnSecondary,
  card,
  cardHeader,
  cardTitle,
  error as errorCls,
  success as successCls,
} from "@/lib/styles";
import type { Plan, SubscriptionDetail } from "@/lib/types";

export default function BillingPage() {
  const { user, loading, refreshMe } = useAuth();
  const router = useRouter();
  const [subscription, setSubscription] = useState<SubscriptionDetail | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loadingSub, setLoadingSub] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    variant: "warning" | "danger";
    action: () => void;
  } | null>(null);

  const owner = user ? isOwner(user) : false;

  useEffect(() => {
    if (!loading && !owner) router.replace("/settings");
  }, [loading, owner, router]);

  useEffect(() => {
    if (!owner) return;
    Promise.all([
      apiFetch<SubscriptionDetail>("/api/v1/subscriptions"),
      apiFetch<Plan[]>("/api/v1/plans"),
    ])
      .then(([sub, p]) => {
        setSubscription(sub);
        setPlans(p);
      })
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setLoadingSub(false));
  }, [owner]);

  async function handleChangePlan(planSlug: string, interval: string) {
    setError("");
    try {
      const sub = await apiFetch<SubscriptionDetail>("/api/v1/subscriptions/plan", {
        method: "PUT",
        body: JSON.stringify({ plan_slug: planSlug, billing_interval: interval }),
      });
      setSubscription(sub);
      setSuccessMsg("Plan updated");
      setTimeout(() => setSuccessMsg(""), 3000);
      await refreshMe();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  function handleCancel() {
    setConfirmAction({
      title: "Cancel Subscription",
      message: "Your access will continue until the end of your current billing period. Are you sure?",
      variant: "danger",
      action: async () => {
        setError("");
        try {
          const sub = await apiFetch<SubscriptionDetail>("/api/v1/subscriptions/cancel", {
            method: "POST",
          });
          setSubscription(sub);
          setSuccessMsg("Subscription canceled");
          setTimeout(() => setSuccessMsg(""), 3000);
          await refreshMe();
        } catch (err) {
          setError(extractErrorMessage(err));
        }
      },
    });
  }

  if (loading || !user || !owner || loadingSub) {
    return (
      <SettingsLayout activeTab="/settings/billing">
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      </SettingsLayout>
    );
  }

  const sub = subscription;
  const currentPlan = sub?.plan;
  const isTrialing = sub?.status === "trialing";
  const isCanceled = sub?.status === "canceled";

  // Calculate trial days left
  let trialDaysLeft = 0;
  if (isTrialing && sub?.trial_end) {
    const end = new Date(sub.trial_end + "T23:59:59");
    trialDaysLeft = Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000));
  }

  return (
    <SettingsLayout activeTab="/settings/billing">
      {error && <p className={`${errorCls} mb-4`}>{error}</p>}
      {successMsg && <p className={`${successCls} mb-4`}>{successMsg}</p>}

      <div className="space-y-6">
        {/* Beta Notice */}
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-4">
          <p className="text-sm text-accent">
            PFV2 is in beta — no charges will be applied. Subscription management is fully functional for testing.
          </p>
        </div>

        {/* Current Plan */}
        <div className={card}>
          <div className={cardHeader}>
            <h2 className={cardTitle}>Current Plan</h2>
          </div>
          <div className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg font-semibold text-text-primary">
                    {currentPlan?.name ?? "None"}
                  </span>
                  {isTrialing && (
                    <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[11px] font-medium text-accent">
                      TRIAL
                    </span>
                  )}
                  {isCanceled && (
                    <span className="rounded-full bg-danger-dim px-2 py-0.5 text-[11px] font-medium text-danger">
                      CANCELED
                    </span>
                  )}
                </div>
                {isTrialing && (
                  <p className="text-sm text-text-muted">
                    Trial ends {sub?.trial_end} — {trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""} remaining
                  </p>
                )}
                {isCanceled && sub?.current_period_end && (
                  <p className="text-sm text-text-muted">
                    Access until {sub.current_period_end}
                  </p>
                )}
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-text-primary">
                  {currentPlan && currentPlan.price_monthly > 0 ? (
                    <>
                      €{sub?.billing_interval === "yearly"
                        ? (currentPlan.price_yearly / 12).toFixed(2)
                        : currentPlan.price_monthly.toFixed(2)}
                      <span className="text-sm font-normal text-text-muted">/mo</span>
                    </>
                  ) : (
                    <>€0<span className="text-sm font-normal text-text-muted">/mo</span></>
                  )}
                </div>
                <p className="text-[11px] text-text-muted">No charge during beta</p>
              </div>
            </div>

            {/* Feature limits */}
            {currentPlan && (
              <div className="mt-6 grid grid-cols-3 gap-4 border-t border-border pt-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Users</p>
                  <p className="text-sm font-medium text-text-primary">
                    {currentPlan.max_users ?? "Unlimited"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Data Retention</p>
                  <p className="text-sm font-medium text-text-primary">
                    {currentPlan.retention_days ? `${currentPlan.retention_days} days` : "Unlimited"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">AI Features</p>
                  <p className="text-sm font-medium text-text-primary">
                    {currentPlan.ai_smart_plan_enabled
                      ? "Full Access"
                      : currentPlan.ai_budget_enabled
                        ? "Budget Only"
                        : "None"}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Available Plans */}
        <div className={card}>
          <div className={cardHeader}>
            <h2 className={cardTitle}>Available Plans</h2>
          </div>
          <div className="p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              {plans.map((plan) => {
                const isCurrent = currentPlan?.slug === plan.slug;
                return (
                  <div
                    key={plan.id}
                    className={`rounded-lg border p-5 ${
                      isCurrent
                        ? "border-accent bg-accent/5"
                        : "border-border"
                    }`}
                  >
                    <div className="mb-3">
                      <h3 className="text-base font-semibold text-text-primary">{plan.name}</h3>
                      <p className="text-xs text-text-muted">{plan.description}</p>
                    </div>
                    <div className="mb-4">
                      <span className="text-xl font-bold text-text-primary">
                        €{plan.price_monthly.toFixed(2)}
                      </span>
                      <span className="text-sm text-text-muted">/mo</span>
                      {plan.price_yearly > 0 && (
                        <p className="text-[11px] text-text-muted">
                          or €{plan.price_yearly.toFixed(2)}/yr (save 20%)
                        </p>
                      )}
                    </div>
                    <ul className="mb-4 space-y-1 text-xs text-text-secondary">
                      <li>
                        {plan.max_users ? `Up to ${plan.max_users} user${plan.max_users > 1 ? "s" : ""}` : "Unlimited users"}
                      </li>
                      <li>
                        {plan.retention_days ? `${plan.retention_days}-day data retention` : "Unlimited retention"}
                      </li>
                      <li>
                        {plan.ai_smart_plan_enabled
                          ? "All AI features"
                          : plan.ai_budget_enabled
                            ? "AI budget suggestions"
                            : "No AI features"}
                      </li>
                    </ul>
                    {isCurrent ? (
                      <span className="inline-block rounded-md bg-accent/20 px-3 py-1.5 text-xs font-medium text-accent">
                        Current Plan
                      </span>
                    ) : (
                      <button
                        onClick={() => handleChangePlan(plan.slug, sub?.billing_interval ?? "monthly")}
                        className={plan.price_monthly > (currentPlan?.price_monthly ?? 0) ? btnPrimary : btnSecondary}
                      >
                        {plan.price_monthly > (currentPlan?.price_monthly ?? 0) ? "Upgrade" : "Downgrade"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Cancel */}
        {sub && sub.status !== "canceled" && currentPlan && currentPlan.price_monthly > 0 && (
          <div className="text-right">
            <button onClick={handleCancel} className="text-xs text-text-muted hover:text-danger">
              Cancel subscription
            </button>
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!confirmAction}
        title={confirmAction?.title ?? ""}
        message={confirmAction?.message ?? ""}
        variant={confirmAction?.variant ?? "warning"}
        onConfirm={() => {
          confirmAction?.action();
          setConfirmAction(null);
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </SettingsLayout>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/settings/billing/page.tsx
git commit -m "feat(billing): add Billing settings page — plan view, upgrade, cancel"
```

---

## Task 15: Superadmin Plan Management Page

**Files:**
- Create: `frontend/app/system/plans/page.tsx`

- [ ] **Step 1: Create the plans management page**

Create `frontend/app/system/plans/page.tsx`:

```typescript
"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiFetch, extractErrorMessage } from "@/lib/api";
import {
  input,
  label,
  btnPrimary,
  btnSecondary,
  card,
  cardHeader,
  cardTitle,
  error as errorCls,
  success as successCls,
  pageTitle,
} from "@/lib/styles";
import type { Plan } from "@/lib/types";

interface PlanWithCount extends Plan {
  org_count?: number;
}

export default function SystemPlansPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [plans, setPlans] = useState<PlanWithCount[]>([]);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [editing, setEditing] = useState<PlanWithCount | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    variant: "warning" | "danger";
    action: () => void;
  } | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPriceMonthly, setFormPriceMonthly] = useState("0");
  const [formPriceYearly, setFormPriceYearly] = useState("0");
  const [formMaxUsers, setFormMaxUsers] = useState("");
  const [formRetentionDays, setFormRetentionDays] = useState("");
  const [formIsCustom, setFormIsCustom] = useState(false);
  const [formSortOrder, setFormSortOrder] = useState("0");

  useEffect(() => {
    if (!loading && (!user || !user.is_superadmin)) router.replace("/dashboard");
  }, [loading, user, router]);

  useEffect(() => {
    if (user?.is_superadmin) loadPlans();
  }, [user]);

  async function loadPlans() {
    try {
      const data = await apiFetch<PlanWithCount[]>("/api/v1/plans/all");
      setPlans(data);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  function resetForm() {
    setFormName("");
    setFormSlug("");
    setFormDescription("");
    setFormPriceMonthly("0");
    setFormPriceYearly("0");
    setFormMaxUsers("");
    setFormRetentionDays("");
    setFormIsCustom(false);
    setFormSortOrder("0");
  }

  function openEdit(plan: PlanWithCount) {
    setEditing(plan);
    setCreating(false);
    setFormName(plan.name);
    setFormSlug(plan.slug);
    setFormDescription(plan.description);
    setFormPriceMonthly(String(plan.price_monthly));
    setFormPriceYearly(String(plan.price_yearly));
    setFormMaxUsers(plan.max_users != null ? String(plan.max_users) : "");
    setFormRetentionDays(plan.retention_days != null ? String(plan.retention_days) : "");
    setFormIsCustom(plan.is_custom);
    setFormSortOrder(String(plan.sort_order));
  }

  function openCreate() {
    setEditing(null);
    setCreating(true);
    resetForm();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const body = {
      name: formName,
      slug: formSlug,
      description: formDescription,
      price_monthly: parseFloat(formPriceMonthly) || 0,
      price_yearly: parseFloat(formPriceYearly) || 0,
      max_users: formMaxUsers ? parseInt(formMaxUsers) : null,
      retention_days: formRetentionDays ? parseInt(formRetentionDays) : null,
      is_custom: formIsCustom,
      sort_order: parseInt(formSortOrder) || 0,
    };

    try {
      if (editing) {
        await apiFetch(`/api/v1/plans/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        setSuccessMsg("Plan updated");
      } else {
        await apiFetch("/api/v1/plans", {
          method: "POST",
          body: JSON.stringify(body),
        });
        setSuccessMsg("Plan created");
      }
      setTimeout(() => setSuccessMsg(""), 3000);
      setEditing(null);
      setCreating(false);
      resetForm();
      await loadPlans();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  function handleDelete(plan: PlanWithCount) {
    setConfirmAction({
      title: "Deactivate Plan",
      message: `Deactivate "${plan.name}"? Organizations currently on this plan will not be affected.`,
      variant: "danger",
      action: async () => {
        setError("");
        try {
          await apiFetch(`/api/v1/plans/${plan.id}`, { method: "DELETE" });
          setSuccessMsg("Plan deactivated");
          setTimeout(() => setSuccessMsg(""), 3000);
          await loadPlans();
        } catch (err) {
          setError(extractErrorMessage(err));
        }
      },
    });
  }

  if (loading || !user?.is_superadmin) return null;

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-8">
        <h1 className={pageTitle + " mb-0"}>Plan Management</h1>
        <button onClick={openCreate} className={btnPrimary}>+ New Plan</button>
      </div>

      {error && <p className={`${errorCls} mb-4`}>{error}</p>}
      {successMsg && <p className={`${successCls} mb-4`}>{successMsg}</p>}

      {/* Plan Form */}
      {(creating || editing) && (
        <div className={`${card} mb-6`}>
          <div className={cardHeader}>
            <h2 className={cardTitle}>{editing ? `Edit: ${editing.name}` : "New Plan"}</h2>
          </div>
          <form onSubmit={handleSubmit} className="p-6 grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Name</label>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} className={input} required />
            </div>
            <div>
              <label className={label}>Slug</label>
              <input
                value={formSlug}
                onChange={(e) => setFormSlug(e.target.value)}
                className={input}
                pattern="[a-z0-9-]+"
                required
                disabled={!!editing}
              />
            </div>
            <div className="col-span-2">
              <label className={label}>Description</label>
              <input value={formDescription} onChange={(e) => setFormDescription(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>Price Monthly (€)</label>
              <input type="number" step="0.01" min="0" value={formPriceMonthly} onChange={(e) => setFormPriceMonthly(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>Price Yearly (€)</label>
              <input type="number" step="0.01" min="0" value={formPriceYearly} onChange={(e) => setFormPriceYearly(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>Max Users (blank = unlimited)</label>
              <input type="number" min="1" value={formMaxUsers} onChange={(e) => setFormMaxUsers(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>Retention Days (blank = unlimited)</label>
              <input type="number" min="1" value={formRetentionDays} onChange={(e) => setFormRetentionDays(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>Sort Order</label>
              <input type="number" value={formSortOrder} onChange={(e) => setFormSortOrder(e.target.value)} className={input} />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input type="checkbox" id="is_custom" checked={formIsCustom} onChange={(e) => setFormIsCustom(e.target.checked)} />
              <label htmlFor="is_custom" className="text-sm text-text-secondary">Custom plan</label>
            </div>
            <div className="col-span-2 flex gap-3 pt-2">
              <button type="submit" className={btnPrimary}>{editing ? "Save" : "Create"}</button>
              <button
                type="button"
                onClick={() => { setEditing(null); setCreating(false); resetForm(); }}
                className={btnSecondary}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Plans Table */}
      <div className={card}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Plan</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Monthly</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Yearly</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Max Users</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Retention</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id} className="border-b border-border">
                  <td className="px-4 py-3">
                    <div className="font-medium text-text-primary">{plan.name}</div>
                    <div className="flex items-center gap-1 text-[11px] text-text-muted">
                      {plan.slug}
                      {plan.is_custom && (
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-400">CUSTOM</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">€{Number(plan.price_monthly).toFixed(2)}</td>
                  <td className="px-4 py-3 text-text-secondary">€{Number(plan.price_yearly).toFixed(2)}</td>
                  <td className="px-4 py-3 text-text-secondary">{plan.max_users ?? "∞"}</td>
                  <td className="px-4 py-3 text-text-secondary">{plan.retention_days ? `${plan.retention_days}d` : "∞"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${plan.is_active ? "bg-success-dim text-success" : "bg-danger-dim text-danger"}`}>
                      {plan.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button onClick={() => openEdit(plan)} className="text-xs text-accent hover:underline">Edit</button>
                    {plan.is_active && (
                      <button onClick={() => handleDelete(plan)} className="text-xs text-text-muted hover:text-danger">Deactivate</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmModal
        open={!!confirmAction}
        title={confirmAction?.title ?? ""}
        message={confirmAction?.message ?? ""}
        variant={confirmAction?.variant ?? "warning"}
        onConfirm={() => {
          confirmAction?.action();
          setConfirmAction(null);
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </AppShell>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/system/plans/page.tsx
git commit -m "feat(billing): add superadmin plan management page at /system/plans"
```

---

## Task 16: Backfill Subscriptions for Existing Orgs

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Add subscription backfill to app lifespan**

In `backend/app/main.py`, add an import:

```python
from app.services import subscription_service
from app.database import async_session
from app.models.subscription import Subscription
from app.models.user import Organization
```

Update the `lifespan` function to backfill subscriptions after migrations:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    _run_migrations()
    await _backfill_subscriptions()
    await logger.ainfo("starting", app=app_settings.app_name, env=app_settings.app_env)
    yield
    await engine.dispose()
    await logger.ainfo("shutdown complete")


async def _backfill_subscriptions() -> None:
    """Create trial subscriptions for any orgs that don't have one yet."""
    async with async_session() as db:
        result = await db.execute(
            select(Organization.id).where(
                ~Organization.id.in_(select(Subscription.org_id))
            )
        )
        org_ids = [row[0] for row in result.all()]
        for org_id in org_ids:
            await subscription_service.create_trial(db, org_id)
        if org_ids:
            await db.commit()
            await logger.ainfo("backfilled subscriptions", count=len(org_ids))
```

Also add the missing imports at the top:

```python
from sqlalchemy import select, text
```

(The `text` import may already exist — just ensure `select` is there.)

- [ ] **Step 2: Verify backfill runs**

Run: `cd /Users/fjorge/src/pfv && docker compose restart backend && docker compose logs backend --tail 20`

Expected: Should see "backfilled subscriptions" log line with count of existing orgs, or no log if all orgs already have subscriptions.

- [ ] **Step 3: Commit**

```bash
git add backend/app/main.py
git commit -m "feat(billing): backfill trial subscriptions for existing orgs on startup"
```

---

## Task 17: User Menu — Update Links for Settings Hub

**Files:**
- Modify: `frontend/components/AppShell.tsx`

- [ ] **Step 1: Update user dropdown menu links**

In the user expanded dropdown section of `AppShell.tsx`, change the Security link from `/settings/security` to `/settings/security` (stays the same) and add a Settings link. Replace the existing user dropdown links (the `{userExpanded && (...)}` block) to update the Profile and Security links:

The Profile link stays as `/profile` and the Security link stays as `/settings/security`. No change needed here since the tabbed hub handles the routing and the Security page already exists at that path.

- [ ] **Step 2: Verify all navigation works**

Start the dev server and verify:
1. Sidebar "Settings" link goes to `/settings` (redirects to `/profile`)
2. `/settings/organization` shows org settings with tabs
3. `/settings/billing` shows billing page with tabs
4. `/settings/security` shows security page
5. Superadmin sees "System > Plans" in sidebar
6. Trial banner shows in header

Run: `cd /Users/fjorge/src/pfv && docker compose up -d && docker compose logs frontend --tail 5`

- [ ] **Step 3: Commit**

```bash
git add frontend/components/AppShell.tsx
git commit -m "feat(billing): finalize navigation links for settings hub"
```

---

## Task 18: TypeScript Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run TypeScript check**

Run: `cd /Users/fjorge/src/pfv && docker compose exec frontend npx tsc --noEmit`

Expected: No errors. If there are errors, fix them before proceeding.

- [ ] **Step 2: Run Next.js build**

Run: `cd /Users/fjorge/src/pfv && docker compose exec frontend npx next build`

Expected: Build succeeds. Fix any errors.

- [ ] **Step 3: Commit any fixes**

If fixes were needed:

```bash
git add -A
git commit -m "fix(billing): resolve TypeScript build errors"
```

---

## Task 19: End-to-End Smoke Test

- [ ] **Step 1: Restart all services**

Run: `cd /Users/fjorge/src/pfv && docker compose down && docker compose up -d`

- [ ] **Step 2: Verify backend endpoints**

Run these curl commands against `http://localhost/api/v1`:

```bash
# List active plans (authenticated)
curl -s http://localhost/api/v1/plans | python3 -m json.tool

# Get subscription for current org (authenticated — use a real token)
# Register a new user first if needed, then use the token
```

- [ ] **Step 3: Verify frontend pages**

Open `http://localhost` in browser and verify:

1. **Header** — trial banner shows "Pro Trial — X days left"
2. **Sidebar** — "Settings" link under Admin section
3. **Settings Hub** — `/settings` redirects to profile; tabs visible based on role
4. **Organization tab** — `/settings/organization` shows billing cycle, period, advanced config
5. **Billing tab** — `/settings/billing` shows current plan, available plans, upgrade/downgrade buttons
6. **Superadmin** — `/system/plans` shows plan table with edit/create/deactivate

- [ ] **Step 4: Test plan change flow**

1. Go to `/settings/billing`
2. Click "Downgrade" on the Free plan
3. Verify subscription updates and trial banner changes to "Free Plan — Upgrade"
4. Click "Upgrade" back to Pro
5. Verify plan switches back

- [ ] **Step 5: Final commit if any fixes**

```bash
git add -A
git commit -m "fix(billing): smoke test fixes"
```
