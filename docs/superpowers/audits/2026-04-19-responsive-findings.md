# Responsive Audit Findings — 2026-04-19

Source: spec `docs/superpowers/specs/2026-04-19-responsive-sweep-design.md`.

## Method
Code scan followed by visual verification (pending per-page). Viewport targets: 375px, 768px, 1280px.

## Findings table

| Page | Current state | Symptom < md | Chosen pattern | PR |
|---|---|---|---|---|
| transactions | 12-col CSS grid "table" (`grid grid-cols-12`) for rows + a wrap-capable filter bar (`flex flex-wrap` with `min-w-[200px]` search field). Quick-add form is already `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`. Row container wrapped in `overflow-x-auto`. | 12-col grid squeezes every cell (date/description/category/amount) into unreadable widths; tiny action icons drop below the 44px tap target. Filter bar wraps but each 200px-min field still forces horizontal scroll on 375px. | Card (A) | PR1 |
| forecast-plans | Plain table built as a custom grid via `grid-cols-[1fr_100px_100px_100px_80px(_100px)]` template. No `overflow-x-auto`, no `sm:/md:` on the row template. Inline bar-chart section uses fixed `style={{ height }}`. Filters row is `flex flex-wrap` with `min-w-[200px]`. | Fixed px column template plus chart row blow past 375px viewport → horizontal page scroll. Numeric columns still render but category names truncate hard. | Hybrid (B) | PR1 |
| budgets | Summary tiles in a `flex gap-4` row of three cards (no breakpoint), category list built from raw `flex` rows with per-row progress bars and transfer form (`flex flex-wrap` + `basis-40`). Chart section uses `style={{ height }}`. Add form is `flex flex-wrap`. No `sm:/md:/lg:` anywhere in the file. | Three summary cards stay side-by-side on 375px and shrink to ~100px each, truncating amounts. Inline progress bars + action buttons on the same row push off-screen; the transfer sub-form overlaps. | Hybrid (B) | PR1 |
| recurring | Two `grid grid-cols-12` "tables" (active / inactive) wrapped in `overflow-x-auto`. No headers, no breakpoint prefixes. Actions live in `col-span-2 flex justify-end gap-2`. | 12-col grid collapses every cell on 375px; action buttons undersized; horizontal scroll is required just to see the amount. | Card (A) | PR2 |
| accounts | Two-column `grid grid-cols-1 gap-6 lg:grid-cols-2` outer layout, then each column renders a list of `flex items-center justify-between` rows with inline delete/edit/form controls. | Outer layout already stacks below `lg`, but inner rows squeeze name + balance + actions into one flex row; on 375px the action icons wrap under the balance. Add-account form (`flex gap-2`) overflows. | Card (A) | PR2 |
| categories | Master/sub category list with nested forms (`flex flex-wrap gap-3`) and per-row flex controls including color swatches, rename input, delete. Two `min-w-[200px]` inputs in the master-add form. | Add form's two 200px-min fields force overflow at 375px; sub-category rows with color swatch + name + two buttons push actions offscreen. | Card (A) | PR2 |
| import | Wizard with file-upload step, preview table (7 columns: Skip/Date/Description/Amount/Type/Category/Transfer) wrapped in `overflow-x-auto`, and summary footer (`flex items-center gap-4`). Description cell uses `max-w-[300px] truncate`. Action bar is `flex gap-4 border-t`. No `sm:/md:` prefixes. | 7-col table needs the outer `overflow-x-auto` (already present) but wizard chrome/step indicators sit in unqualified `flex` rows that wrap awkwardly. Action bar's side-by-side buttons still fit, but upload + account picker row collapses. | Form-stack adapted | PR2 |
| login / register / forgot / reset / verify / mfa / setup | Centered card (`max-w-sm` or `max-w-md`) with `space-y-5` form stack. Register uses `flex gap-3` first-name/last-name pair. Setup is `max-w-md` stack. None have responsive prefixes, but the centered card sits on `px-4` so it doesn't overflow. | Auth forms are already stack-shaped and narrow; the only sub-md break is the register first/last-name `flex gap-3` which squeezes both inputs to ~140px on 375px. Nothing goes offscreen but submit buttons can be pushed under soft keyboards (not in scope here, but pattern still applies). | Form-stack (C) | PR2 |
| settings/* | Settings hub (`/settings`) renders inline profile card + `flex gap-3` first/last-name pair. `settings/security` has 2FA blocks using `grid grid-cols-2 gap-2` for recovery codes and `flex gap-3` rows; uses `max-w-[200px]` on session-duration input. `settings/organization` has billing-cycle form (`flex items-end gap-3`) and a raw `<table>` (no `overflow-x-auto`) for key/value settings. `settings/billing` has `mt-6 grid grid-cols-3 gap-4` usage summary + a `grid gap-4 sm:grid-cols-2` plans grid. | Unqualified 2-col grids (recovery-code blocks, billing summary 3-col) squeeze to unreadable widths at 375px. Org settings `<table>` is the only table in the app without `overflow-x-auto` — it will cause page-level horizontal scroll. First/last-name `flex gap-3` on the hub shrinks inputs. | Form-stack (C) | PR2 |
| admin/settings | 12-line file: `useEffect` redirect to `/settings/organization`. Nothing to render. | N/A — no UI. Still listed because it appears on route inventory. | Form-stack (C) | PR2 |
| system/plans | Plan-create/edit form is `p-6 grid grid-cols-2 gap-4` (unqualified). Plans list is a `<table>` wrapped in `overflow-x-auto`. Actions bar is `col-span-2 flex gap-3`. | 2-col form cuts every label/input to ~160px on 375px; numeric pricing inputs get crammed. Table is already scroll-wrapped. | Form-stack (C) | PR2 |
| dashboard | Already heavily breakpoint-prefixed: `grid-cols-1 lg:grid-cols-2`, `grid-cols-1 lg:grid-cols-3`, summary uses `grid-cols-2 gap-4` inside a card (small tiles, ok), `flex gap-3 overflow-x-auto` for chip strip, `flex-col sm:flex-row` for charts. Two inner `grid grid-cols-2 gap-4` blocks (summary tiles inside cards) and a Quick-Add form at `grid-cols-2 gap-3 lg:grid-cols-4` remain unqualified at `sm:`. | Quick-Add form crams four fields into 2 cols on 375px → inputs narrow but readable; summary tile `grid-cols-2` stays OK because tiles are small. No full-page horizontal scroll observed in code. | — (regression only) | PR2 |

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

- **Budgets inline charts (Pattern B risk).** Spec already calls this out: inline bar charts use `style={{ height }}` and won't comfortably survive hide-and-scroll. If the hybrid feels cramped in PR1 visual verification, Budgets falls back to Pattern A (card) and we document the exception. Likely needs a decision during PR1 implementation, not now.
- **Transactions "table" is actually a CSS grid**, not a `<table>`. Pattern A still applies (stack rows as cards below `md`), but the column-header row at line 503 and every row at 534/564 all use `grid grid-cols-12`. The fix is the same shape as if it were a real table but won't rely on `hidden md:table-cell`. Worth confirming during PR1 that card rendering doesn't require re-parenting the grid wrapper.
- **`settings/organization` has a bare `<table>`** (line 256) with no `overflow-x-auto`. This is the only such case in the app and is the most likely cause of page-level horizontal scroll on `/settings/organization` at 375px. Fix is trivial (wrap in `overflow-x-auto`) but noting it here so PR2 doesn't miss it.
- **Recurring page has no column headers** — the 12-col grid only renders data rows. When we transform to cards below `md`, the primary field choice is the description; confirm during PR2 that's the right "card title" field (vs. next-due-date).
