# Responsive Audit Findings — 2026-04-19

Source: spec `docs/superpowers/specs/2026-04-19-responsive-sweep-design.md`.

## Method
Code scan followed by visual verification. Viewport targets: 375px, 768px, 1280px.

## Status
- **PR1 implementation:** merged (#63). Transactions, Forecast Plans, Budgets.
- **PR2 implementation:** complete, pending visual verification. Recurring, Accounts, Categories, Import, Auth pages, Settings pages + SettingsLayout, System Plans, ConfirmModal, Dashboard.

## Findings table

| Page | Current state | Symptom < md | Chosen pattern | PR |
|---|---|---|---|---|
| transactions | 12-col CSS grid "table" (`grid grid-cols-12`) for rows + a wrap-capable filter bar. **PR1 fix:** header row + grid rows gated `hidden md:block`; new `md:hidden` card sibling renders the same transactions with amount, date/account subline, category, and Edit/Settle/Delete buttons at `min-h-[44px]`. Filter bar stacks `flex-col sm:flex-row`. Inline edit form stacks at `grid-cols-1 sm:grid-cols-2`. | Original: 12-col grid squeezed fields to unreadable widths below `md`. Resolved by card layout. | Card (A) | PR1 ✅ |
| forecast-plans | Custom CSS-grid "table" (`grid-cols-[...]`). **PR1 fix:** grid template becomes `grid-cols-[1fr_100px]` below `md`, restores full template at `md+`. Actual/Variance/Source cells gated `hidden md:block`. Inline summary line inside Category cell shows Actual/Variance/Source below `md`. Wrapper uses `overflow-x-auto` with `min-w-[320px]` fallback (not 640 — the mobile column set fits 320 naturally, per implementer). Add-item form stacks `flex-col sm:flex-row`. | Original: fixed px template overflowed at 375px; category names truncated. Resolved by hide-and-scroll with inline summary. | Hybrid (B) | PR1 ✅ |
| budgets | Flex-row per budget with inline progress bar, amount, and actions. **PR1 fix:** each row reflows to `flex-col md:flex-row md:items-center md:justify-between`; amount duplicated with `ml-auto md:hidden` (mobile position) and `hidden md:inline` (desktop position) so only one shows per viewport. Actions get `flex flex-wrap`, `min-h-[44px] md:min-h-0`. Summary tiles: `grid-cols-1 sm:grid-cols-3`. Add-budget + transfer inline forms: `flex-col sm:flex-row`. Header action row: `flex-col sm:flex-row sm:items-center`. No per-row expansion chart — page has a single aggregate bar chart, no change. | Original: amounts overlapped category names; Transfer/Edit/Remove too small to tap; summary cards shrank to unreadable widths on 375px. All three resolved. | Reflow (A-adapted) | PR1 ✅ |
| recurring | Two `grid grid-cols-12` "tables" (active / paused). **PR2 fix:** each grid gated `hidden md:block`; `md:hidden` card sibling mirrors fields (description, next-due, account, category, cadence, amount with sign tone). Empty-state replicated for both surfaces. | Original: unreadable on 375px, actions undersized. Resolved. | Card (A) | PR2 ✅ |
| accounts | Two-column `grid grid-cols-1 lg:grid-cols-2` outer layout. **PR2 fix:** each row now `flex flex-col gap-3 md:flex-row md:items-center md:justify-between` (name/metadata / balance / actions). Add-account form stacks `flex-col sm:flex-row`; Create button `w-full sm:w-auto min-h-[44px]`. Inline edit row stacks below `sm`. Account-type list + add-type form also form-stacked. | Original: name+balance+actions squeezed, action icons wrapped. Resolved. | Row reflow (A) | PR2 ✅ |
| categories | Master/sub tree. **PR2 fix:** master-add form stacks `flex-col sm:flex-row`; both `min-w-[200px]` inputs become `w-full sm:min-w-[200px]`. Rows use `flex flex-wrap items-center justify-between`; name truncates via `min-w-0 flex-1 truncate`; action buttons wrap with `min-h-[44px] md:min-h-0`. Sub-category rows same treatment. Sub-container indent `px-4 md:px-6`. | Original: two 200px inputs overflowed, action buttons pushed offscreen. Resolved. | Reflow-and-wrap | PR2 ✅ |
| import | Wizard with upload + preview table (7 columns) + action bar. **PR2 fix:** upload button `w-full sm:w-auto min-h-[44px]`. Preview summary bar stacks below `sm`. Preview table gets `min-w-[720px]` inside existing `overflow-x-auto` wrapper. Action bar uses `flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-4` with explicit `sm:order-*` to keep desktop left-to-right order; buttons `w-full sm:w-auto min-h-[44px]`. Results action bar same treatment. | Original: upload+picker row collapsed, action buttons squeezed. Resolved. | Form-stack adapted | PR2 ✅ |
| auth (login/register/forgot/reset/verify/mfa/setup) | All already centered `max-w-sm/md` with `px-4`. **PR2 fix:** only Register needed touches — first-name/last-name pair `flex gap-3` → `grid grid-cols-1 sm:grid-cols-2 gap-3`. Other six verified responsive, no changes. | Original: Register first/last-name squeezed to ~140px. Resolved. Others were clean. | Form-stack (C) | PR2 ✅ |
| settings (hub + billing + org + security) + SettingsLayout | **PR2 fix:**<br/>- **SettingsLayout:** tab bar becomes `<nav overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0>` with edge-bleed scroll on phones; tabs get `whitespace-nowrap`.<br/>- **settings/page.tsx:** first/last-name pair → responsive grid.<br/>- **settings/billing:** usage summary `grid-cols-3` → `grid-cols-1 sm:grid-cols-3`; action buttons `w-full sm:w-auto min-h-[44px]`.<br/>- **settings/organization:** bare `<table>` wrapped in `overflow-x-auto` with `min-w-[640px]`; billing-cycle and advanced-config forms form-stacked; action buttons responsive.<br/>- **settings/security:** both recovery-code grids `grid-cols-2` → `grid-cols-1 sm:grid-cols-2`; session-duration input `w-full sm:max-w-[200px]`; QR img `max-w-full`; action button pairs `flex-col sm:flex-row` with `min-h-[44px]`. | Original: recovery codes squeezed, bare table forced page scroll, billing summary unreadable. All resolved. | Form-stack (C) | PR2 ✅ |
| admin/settings, profile | 12-line redirect stubs. Verified render `null` after `router.replace(...)`. No UI — no change needed. | N/A | — | PR2 ✅ (verified) |
| system/plans | Plan create/edit form + plans table. **PR2 fix:** header row `flex-col sm:flex-row`; form grid `grid-cols-2` → `grid-cols-1 sm:grid-cols-2`; form action bar `flex-col-reverse sm:flex-row` with `flex-col-reverse` to keep Submit on top on phones; table now `w-full` inside card with `w-full overflow-x-auto` wrapper and table `min-w-[640px]` (fixed the user-reported horizontal page scroll — was caused by missing `min-w-*` escaping card width). | Original: 2-col form + page-level horizontal scroll on table. Resolved. | Form-stack + hybrid table | PR2 ✅ |
| dashboard | **PR2 fix (upgraded from regression-check after user found horizontal scroll on account cards):** Account cards container `flex overflow-x-auto` → `grid grid-cols-1 gap-3 sm:flex sm:gap-3 sm:overflow-x-auto` (stacks on phones, restores horizontal carousel at `sm+`); shrink-0 + min-widths gated behind `sm:`. Quick-Add form grid-cols-2 → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`. Executed+Forecast card summary tiles `grid-cols-2` → `grid-cols-1 sm:grid-cols-2`. | Original: fixed-min-width account cards overflowed viewport on phones; Quick-Add + summary tiles crammed. Resolved. | Reflow | PR2 ✅ |

## Raw scan output

### Step 1 — Fixed pixel widths / inline width-height styles

```
frontend/app/settings/security/page.tsx:452:                  className={`${input} max-w-[200px]`}
frontend/app/forecast-plans/page.tsx:471:            <div className="min-w-[200px] flex-1">
frontend/app/forecast-plans/page.tsx:567:              <div style={{ height: Math.max(chartData.length * 40, 100) }}>
frontend/app/dashboard/page.tsx:589:                <div className="p-4" style={{ height: Math.max(budgets.slice(0, 6).length * 40, 100) }}>
frontend/app/dashboard/page.tsx:639:                <div style={{ height: Math.max(Math.min(forecast.categories.length, 8) * 32, 100) }}>
frontend/app/transactions/page.tsx:426:        <div className="flex-1 min-w-[200px]">
frontend/app/budgets/page.tsx:169:            <div className="flex-1 min-w-[200px]">
frontend/app/budgets/page.tsx:216:              <div className="p-4" style={{ height: Math.max(budgets.length * 36, 100) }}>
frontend/app/import/page.tsx:284:                      <td className="max-w-[300px] truncate px-4 py-2 text-text-primary" title={previewRow.description}>
frontend/app/categories/page.tsx:173:            <div className="flex-1 min-w-[200px]">
frontend/app/categories/page.tsx:185:            <div className="flex-1 min-w-[200px]">
```

(AppShell.tsx hits for `h-[18px] w-[18px]` on SVG icon sizes are intentional and omitted — those are 18px nav glyphs, not layout widths.)

### Step 2 — Unqualified multi-column grids (no `sm:`/`md:`/`lg:` prefix)

```
frontend/app/settings/security/page.tsx:323:              <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-raised p-4">
frontend/app/settings/security/page.tsx:379:                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-raised p-4">
frontend/app/settings/billing/page.tsx:181:              <div className="mt-6 grid grid-cols-3 gap-4 border-t border-border pt-4">
frontend/app/dashboard/page.tsx:441:              <div className="grid grid-cols-2 gap-4">
frontend/app/dashboard/page.tsx:464:                  <div className="grid grid-cols-2 gap-4">
frontend/app/system/plans/page.tsx:176:          <form onSubmit={handleSubmit} className="p-6 grid grid-cols-2 gap-4">
```

### Step 3 — `<table>` without `overflow-x-auto` wrapper in same file

```
NEEDS-WRAP: frontend/app/settings/organization/page.tsx
```

(`frontend/app/system/plans/page.tsx` and `frontend/app/import/page.tsx` contain both `<table` and `overflow-x-auto` — they passed the check.)

### Step 4 — Pages with zero `sm:`/`md:`/`lg:`/`xl:` classes

```
NO-RESPONSIVE: frontend/app/mfa-verify/page.tsx
NO-RESPONSIVE: frontend/app/settings/organization/page.tsx
NO-RESPONSIVE: frontend/app/settings/security/page.tsx
NO-RESPONSIVE: frontend/app/settings/page.tsx
NO-RESPONSIVE: frontend/app/auth/google/callback/page.tsx
NO-RESPONSIVE: frontend/app/setup/page.tsx
NO-RESPONSIVE: frontend/app/admin/settings/page.tsx
NO-RESPONSIVE: frontend/app/system/plans/page.tsx
NO-RESPONSIVE: frontend/app/verify-email/page.tsx
NO-RESPONSIVE: frontend/app/register/page.tsx
NO-RESPONSIVE: frontend/app/profile/page.tsx
NO-RESPONSIVE: frontend/app/forgot-password/page.tsx
NO-RESPONSIVE: frontend/app/budgets/page.tsx
NO-RESPONSIVE: frontend/app/reset-password/page.tsx
NO-RESPONSIVE: frontend/app/import/page.tsx
NO-RESPONSIVE: frontend/app/page.tsx
NO-RESPONSIVE: frontend/app/categories/page.tsx
NO-RESPONSIVE: frontend/app/login/page.tsx
NO-RESPONSIVE: frontend/app/recurring/page.tsx
```

`frontend/app/page.tsx`, `frontend/app/profile/page.tsx`, `frontend/app/admin/settings/page.tsx`, and `frontend/app/auth/google/callback/page.tsx` are all router redirects / stubs with no UI — they're listed by the scan but don't need remediation.

## Open questions

- **Budgets: page has no per-row chart** — just a single aggregate bar chart above the list. Plan's Step 3 about per-row expansion grids did not apply; handled gracefully during PR1.
- **Transactions "table" is a CSS grid, not a `<table>`** — confirmed during PR1. Used `hidden md:block` + `md:hidden` card sibling instead of `hidden md:table-cell`. Pattern A still applied successfully.
- **`settings/organization` has a bare `<table>`** (line 256) with no `overflow-x-auto` — carried into PR2.
- **Recurring page has no column headers** — primary card-title field decision (description vs next-due-date) carried into PR2.
- **Period nav icon buttons on Budgets** deliberately not bumped to 44px during PR1 (they are tight icon-only affordances flanking date text). Revisit if touch tests show they're hard to tap.
- **Shared `btnPrimary` in `frontend/lib/styles.ts`** renders ~36–38px, below the 44px mobile touch target. PR2 added per-button `min-h-[44px]` overrides on auth + settings + system-plans action buttons. A systemic fix (add `min-h-[44px] md:min-h-0` to `btnPrimary` itself, or create a `btnPrimaryMobile` variant) would be a cleaner long-term solution but is deferred — introducing it would affect every button in the app and wants its own visual review.
- **ConfirmModal (Task 17)** is the single shared modal for all 9 pages that confirm destructive actions. Hardened once, covers all of them. `AppShell.tsx` also has a `fixed inset-0` element but it's the mobile sidebar backdrop (tap-to-close scrim), not a dialog.
