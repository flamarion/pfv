# P3 — UI Polish for Production

**Date:** 2026-04-15
**Branch:** feat/p3-ui-polish
**Status:** Implemented (PR #55)

## Goal

Make PFV2 feel professional for real users. Friends are actively testing — first impressions matter. The app works functionally but has visual inconsistencies, broken responsive behavior, and raw browser dialogs that undermine trust in a finance product.

## Scope

12 items grouped into shared infrastructure + per-item changes. Responsive layout is the highest priority — half-screen browser use is currently broken.

---

## Shared Infrastructure

### 1. ConfirmModal Component

**File:** `frontend/components/ui/ConfirmModal.tsx`

Reusable confirmation dialog replacing all `window.confirm()` calls.

**Props:**
- `open: boolean` — controls visibility
- `title: string` — dialog heading
- `message: string | ReactNode` — body content
- `confirmLabel?: string` — default "Confirm"
- `cancelLabel?: string` — default "Cancel"
- `variant?: "default" | "warning" | "danger"` — controls confirm button color
- `onConfirm: () => void`
- `onCancel: () => void`

**Behavior:**
- Backdrop overlay (semi-transparent dark), click-outside dismisses
- Centered card with focus trap (trap focus within modal while open)
- ESC key dismisses
- Confirm button gets variant-appropriate color: default=accent, warning=amber, danger=red
- Body scroll locked while open

### 2. Responsive Layout System

**File:** `frontend/components/AppShell.tsx` (modify existing)

Three breakpoints using Tailwind responsive prefixes:

| Breakpoint | Sidebar | Content | Nav |
|-----------|---------|---------|-----|
| `>=1024px` | Full sidebar (current) | Side-by-side with sidebar | Sidebar links |
| `768-1023px` | Icon-only, expand on click | Full width minus icon bar | Icon sidebar |
| `<768px` | Hidden | Full width | Hamburger menu with slide-out overlay |

**Per-page responsive rules:**
- **Tables:** Wrap in `overflow-x-auto` container. No layout changes — horizontal scroll on narrow screens.
- **Dashboard cards:** CSS grid that collapses from multi-column to single-column below 768px.
- **Forms:** Inputs go full-width below 768px. Side-by-side form groups stack vertically.
- **Charts:** Reduce YAxis `width` prop on narrow screens. Allow parent container to scroll if chart exceeds viewport.

### 3. Chart Click-to-Filter Pattern

Extend the existing `chartFilter` pattern (already used by dashboard spending donut) to budget and forecast bar charts.

**Mechanism:**
- `onClick` handler on `<Bar>` components reads the clicked category from the chart data
- Sets `chartFilter` state to the clicked category name
- Transaction list below filters to show only that category
- Clicking again (or clicking a "clear filter" chip) resets

On dedicated pages (Budgets, Forecast), clicking a bar navigates to `/transactions?category=<name>` since those pages don't have inline transaction lists.

---

## Per-Item Changes

### A. Tooltip Text Colors

**Files:** Dashboard, Budgets page, Forecast page — wherever `<Tooltip>` formatters exist.

Color the numeric values in chart tooltips to match semantic meaning:
- Green: remaining, under-plan, income
- Red: over-budget, over-plan
- Amber: spent, planned

Apply via inline `style` on the `<span>` returned by the Recharts `formatter` prop.

### B. Dashboard Balance Refresh After Settle/Unsettle

**File:** `frontend/app/dashboard/page.tsx`

After a transaction is settled/unsettled via the inline transaction list, call `mutate("/api/v1/accounts")` (or the appropriate SWR key for the accounts fetch) so the account balance cards re-render without a full page reload.

### C. Forecast Chart Overflow Fix

**Already implemented** on the current branch. The `Planned vs Actual (Expenses)` card on the forecast-plans page gets `overflow-hidden` and `margin.right: 20` on the `<BarChart>` to prevent bars from bleeding past the card edge.

### D. CategorySelect on Import Page

**File:** `frontend/app/import/page.tsx`

Replace the plain `<select>` dropdown (around line 298) with the existing `CategorySelect` component. This gives type-ahead search, recent categories, and grouped master/sub display — critical with the current number of pre-seeded categories.

**Props mapping:**
- `value` = `rowState.category_id`
- `onChange` = calls `updateRow(previewRow.row_number, { category_id })`
- `categories` = existing `catOptions` array
- `filterType` = based on transaction type (expense/income)

### E. Transfer Category Picker

**Files:** `frontend/app/dashboard/page.tsx` (quick-transfer form), `frontend/app/transactions/page.tsx` (transfer form)

Add an optional `CategorySelect` to both transfer forms. Defaults to empty (which means backend auto-assigns "Transfer" category), but user can override to e.g. "General Savings" for savings transfers that should count in budgets.

Label: "Category (optional)" with helper text: "Defaults to Transfer. Override to track in budgets."

### F. Budget Transfer Form Visibility Fix

**File:** `frontend/app/budgets/page.tsx`

When the budget transfer row expands to show the transfer form, the source row's spent/budget/percentage figures currently disappear. Fix: keep those figures visible while the form is expanded. This is likely a conditional CSS class that hides the row content — change it to only hide the action buttons, not the data cells.

### G. Replace window.confirm() with ConfirmModal

**Audit scope:** Search all `window.confirm(` calls in frontend/ and replace each with the shared ConfirmModal.

Expected locations (verify during implementation):
- Delete transaction
- Delete budget
- Delete account
- Close billing period
- Disable MFA
- Delete forecast plan
- Any other destructive actions

Each gets an appropriate variant:
- `danger` for deletes (red confirm button)
- `warning` for close-period, disable-MFA (amber confirm button)
- `default` for non-destructive confirmations

### H. Dashboard Chart Consistency

**File:** `frontend/app/dashboard/page.tsx`

**Budget bar chart:** Match the Budgets page color scheme:
- Normal spend: accent/default
- `>80%` of budget: amber/warning
- Over budget: red/danger
- Show "Remaining" as a stacked lighter segment

**Forecast bar chart:** Match the Forecast page color scheme:
- Planned: amber (`#D4A64A`)
- Under plan (actual < planned): green (`#4ade80`)
- Over plan (actual > planned): red (`#f87171`)

Legends on both charts must match their dedicated page counterparts exactly.

### I. Clickable Bar Charts

**Files:** Dashboard page, Budgets page, Forecast page

**Dashboard:** Clicking a budget or forecast bar sets `chartFilter` to that category, filtering the transaction list below (same pattern as spending donut).

**Budgets/Forecast pages:** Clicking a bar navigates to `/transactions?category=<slug>` to show filtered transactions for that category.

Add `cursor: pointer` style on bars and a subtle hover highlight.

### J. Show All Active Accounts on Dashboard

**File:** `frontend/app/dashboard/page.tsx`

Remove the filter that hides zero-balance accounts. All active (non-archived) accounts should appear in the account cards section. Users need to see their credit card account even after paying the bill (balance = 0).

---

## Implementation Order

Shared infrastructure first, then layer changes on top:

1. **Responsive layout** (highest priority — currently broken for half-screen use)
2. **ConfirmModal component**
3. **Replace window.confirm()** (uses ConfirmModal)
4. **Dashboard chart consistency** (colors + legends)
5. **Clickable bar charts** (uses chart click pattern)
6. **Quick wins** (tooltip colors, balance refresh, forecast overflow, CategorySelect on import, transfer category picker, budget transfer visibility, show all accounts)

## Out of Scope

- Mobile native app / PWA
- Budget rebalancing suggestions (P3 roadmap, deferred to next round)
- Transfer exclusion from spending chart (complex logic change, deferred)
- "Add category" inline creation (needs new backend endpoint, deferred)
- Onboarding wizard / demo seed / user manual (deferred)
- Notification preferences (deferred)
