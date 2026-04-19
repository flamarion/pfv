# Responsive Sweep — Full App Mobile Audit & Fix

**Status:** Design approved, pending implementation plan
**Date:** 2026-04-19
**Owner:** fjorge
**Scope:** Single milestone across two PRs

## Goal

Every authenticated page in PFV2 renders correctly from 320px through 1024px+. No horizontal page scroll, no truncated numeric columns, no offscreen submit buttons, no untappable controls.

## Non-goals

- No new features. No design overhaul. No component library migration.
- No custom breakpoints. Only Tailwind's built-in `sm=640`, `md=768`, `lg=1024`.
- No tablet-specific (landscape) layouts beyond what `md` naturally provides.

## Audit method (hybrid)

1. **Code scan** across `frontend/app/` and `frontend/components/`:
   - Fixed pixel widths (`w-[Npx]`, inline styles)
   - `<table>` elements without responsive treatment
   - `grid-cols-*` and `flex-*` without breakpoint variants
   - Pages with zero `sm:`/`md:`/`lg:` classes
   - Missing `overflow-x-auto` on wide content containers
2. **Findings table** produced in PR description: page → viewport where it breaks → symptom → chosen pattern.
3. **Visual verification** via chrome-devtools at **375px** (iPhone SE baseline) and **768px** (portrait tablet edge). Logged-in state with seeded data. Screenshots attached to PR.

## Fix pattern library

Each page picks exactly one primary pattern. Patterns are shared, not one-offs.

### Pattern A — Card layout (default for row-based data)

Applies to: Transactions, Recurring, Accounts, Categories.

- `<table>` stays on `md+`.
- Below `md`, rows render as stacked `<article>` cards:
  - Primary field (description / name) as card header
  - Secondary fields as label/value rows
  - Amounts always visible and right-aligned within the card
  - Actions (edit / delete / etc.) collected into a single row at the bottom of the card, ≥44px tap height
- If a shared `<DataCard>` component emerges naturally across 2+ pages, extract it into `components/ui/DataCard.tsx`. Do not premature-extract.

### Pattern B — Hybrid hide-and-scroll

Applies to: Budgets, Forecast Plans.

- Keep the table on all breakpoints (expansion rows and inline charts don't transplant well to cards).
- Below `md`: hide low-priority columns using `hidden md:table-cell`.
- Remaining table wrapped in `overflow-x-auto` with a sensible `min-w-*` so the preserved columns stay legible.
- Priority columns (always visible): category name, primary amount, action trigger.

### Pattern C — Form stack

Applies to: login, register, forgot-password, reset-password, verify-email, mfa-verify, setup, profile, settings/*, admin/*, system/plans forms, any modal form bodies.

- Multi-column forms (`grid-cols-2`, side-by-side `flex`) collapse to single column below `sm`.
- Sticky or footer action bars become fixed-bottom on phones to prevent submit buttons being pushed offscreen by soft keyboards.
- Label/input pairs stack; labels never truncate.

### Pattern D — Modal containment

Applies to: every modal (`ConfirmModal`, form modals).

- Shell: `max-w-[calc(100vw-2rem)]` so there's always a margin.
- Body: `max-h-[90vh]` with `overflow-y-auto`.
- Action buttons never hidden below the fold.

## PR decomposition

### PR1 — `fix/responsive-sweep-data-tables`

**Pages:** Transactions, Forecast Plans, Budgets.

**Why these first:** They set the pattern precedents. Transactions establishes the card shape. Forecast Plans and Budgets prove the hybrid approach. If cards feel wrong we iterate here before replicating across PR2.

**Deliverables:**
- Full code-scan audit report in the PR description.
- Responsive classes on the three pages.
- Card component extraction if pattern repetition justifies it.
- Visual-verification screenshots at 375px and 768px for each page.

### PR2 — `fix/responsive-sweep-remaining`

**Pages:**
- Card pattern: Recurring, Accounts, Categories.
- Hybrid / misc: Import wizard (step stacking below `sm`).
- Form-stack: login, register, forgot-password, reset-password, verify-email, mfa-verify, setup, profile, settings (billing, organization, security), admin/settings, system/plans.
- Modal sweep across all variants.
- Dashboard regression check (already considered responsive — confirm no breakage after PR1).

**Deliverables:** same structure as PR1.

## Success criteria

1. No horizontal page-level scroll at 375px on any authenticated page. Intentional inside-container scroll (e.g. a hide-and-scroll table) is OK.
2. All tap targets ≥44px on touch viewports.
3. Numeric columns (amounts, balances, budgets) never truncate below `md`.
4. Form submit buttons always reachable without horizontal or awkward vertical scrolling.
5. Modals never render with their actions offscreen at 375px.
6. No regressions on `md+` — desktop layouts unchanged.

## Out of scope (may surface as follow-ups)

- Genuine visual-design changes (e.g. replacing bar charts with donut charts, #16 in the backlog).
- Tablet-landscape-specific layouts.
- Touch-gesture enhancements (swipe to delete, pull to refresh).
- Backend data shape changes to support different mobile views.

## Risks & mitigations

- **Risk:** Card extraction bikeshed. **Mitigation:** Don't pre-extract; let the second page inform the shape, extract on the third if still useful.
- **Risk:** Hybrid tables still feel cramped on Budgets specifically because of inline bar charts. **Mitigation:** Charts may need their own `sm:`/`md:` size steps; if hybrid doesn't work we fall back to Pattern A for Budgets in PR1 and document the exception.
- **Risk:** Visual regressions on desktop from aggressive mobile-first classes. **Mitigation:** Every responsive class is breakpoint-prefixed; no unqualified overrides. Verify `lg+` layouts visually after PR1.
