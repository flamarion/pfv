# Responsive Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every authenticated page in PFV2 render correctly from 320px through 1024px+, shipping as two reviewable PRs.

**Architecture:** Audit-then-fix using Tailwind's `sm`/`md`/`lg` breakpoints. Four reusable fix patterns (Cards, Hybrid hide-and-scroll, Form-stack, Modal containment) applied per-page based on the spec. Acceptance per page is visual verification at 375px and 768px plus a `lg+` regression check — no new test infrastructure, since the frontend has none today.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind CSS, TypeScript. Chrome DevTools MCP for viewport verification.

**Spec:** `docs/superpowers/specs/2026-04-19-responsive-sweep-design.md`

---

## File-by-File Impact

### PR1 (branch: `fix/responsive-sweep-data-tables`)

| Path | Scope | Pattern |
|---|---|---|
| `frontend/app/transactions/page.tsx` | Full responsive pass | Card (A) |
| `frontend/app/forecast-plans/page.tsx` | Full responsive pass | Hybrid (B) |
| `frontend/app/budgets/page.tsx` | Full responsive pass | Hybrid (B) |
| `frontend/components/ui/DataCard.tsx` | **New** — extracted only if the second page clearly needs the same shape | — |
| `docs/superpowers/audits/2026-04-19-responsive-findings.md` | **New** — audit report committed with PR1 | — |

### PR2 (branch: `fix/responsive-sweep-remaining`, off main after PR1 merges)

| Path | Scope | Pattern |
|---|---|---|
| `frontend/app/recurring/page.tsx` | Full responsive pass | Card (A) |
| `frontend/app/accounts/page.tsx` | Full responsive pass | Card (A) |
| `frontend/app/categories/page.tsx` | Full responsive pass | Card (A) or tighter table |
| `frontend/app/import/page.tsx` | Stack the wizard steps on phones | Form-stack (C) adapted |
| `frontend/app/login/page.tsx` | Breakpoint sweep | Form-stack (C) |
| `frontend/app/register/page.tsx` | Breakpoint sweep | Form-stack (C) |
| `frontend/app/forgot-password/page.tsx` | Breakpoint sweep | Form-stack (C) |
| `frontend/app/reset-password/page.tsx` | Breakpoint sweep | Form-stack (C) |
| `frontend/app/verify-email/page.tsx` | Breakpoint sweep | Form-stack (C) |
| `frontend/app/mfa-verify/page.tsx` | Breakpoint sweep | Form-stack (C) |
| `frontend/app/setup/page.tsx` | Breakpoint sweep | Form-stack (C) |
| `frontend/app/settings/page.tsx` | Breakpoint sweep | Form-stack (C) |
| `frontend/app/settings/billing/page.tsx` | Breakpoint sweep | Form-stack (C) |
| `frontend/app/settings/organization/page.tsx` | Breakpoint sweep | Form-stack (C) |
| `frontend/app/settings/security/page.tsx` | Breakpoint sweep | Form-stack (C) |
| `frontend/app/system/plans/page.tsx` | Breakpoint sweep | Form-stack (C) |
| `frontend/components/SettingsLayout.tsx` | Tabs must wrap/scroll on phones | — |
| `frontend/components/ui/ConfirmModal.tsx` | Max-viewport containment | Modal (D) |
| Inline modals across pages | Same containment rules | Modal (D) |
| `frontend/app/dashboard/page.tsx` | Regression check only — no code changes unless broken | — |

---

## Conventions Used Across All Tasks

- **Commit cadence:** one commit per task's "Step N: Commit" moment. Use the exact commit message supplied. Don't bundle pages into a single commit.
- **Visual verification:** use Chrome DevTools MCP (`mcp__chrome-devtools__*` tools) to navigate to `http://localhost/<path>`, resize to 375×812, screenshot, then resize to 768×1024, screenshot, then resize to 1280×800, screenshot. Save screenshots under `/tmp/responsive-sweep/<page>-<viewport>.png` — do NOT commit them to the repo (they go into PR descriptions only).
- **Logged-in state:** before verification, make sure the dev stack is up (`./pfv status` → running; `./pfv start` if not), then log in as the superadmin account at `http://localhost/login`. Reuse the same session across all verifications.
- **Safe classes recap:**
  - `<table>` containers get `overflow-x-auto` + `min-w-*` when Pattern B is used.
  - Cards use `flex flex-col gap-3 rounded-lg border p-4` as a baseline; amounts right-aligned via `ml-auto`.
  - Tap targets get `min-h-[44px]` (or `h-11`) on action buttons below `md`.
  - Forms below `sm` use `grid-cols-1` instead of `grid-cols-2`; above `sm` they restore their original columns.
- **DRY trigger:** extract a component only after the third repetition of the same shape. Two repetitions = inline. Three = extract to `frontend/components/ui/`.
- **No Tailwind config changes.** If you feel you need a custom breakpoint, stop and flag it in the PR description instead.

---

## Phase 0 — Preflight

### Task 0: Confirm branch and environment

**Files:** none.

- [ ] **Step 1: Confirm branch**

Run:
```bash
git branch --show-current
```
Expected: `fix/responsive-sweep-data-tables`

- [ ] **Step 2: Confirm dev stack is up**

Run:
```bash
./pfv status
```
Expected: backend, frontend, nginx, mysql all running. If not, run `./pfv start` and wait for "Migrations complete" in the backend logs.

- [ ] **Step 3: Sanity-open the app**

Run:
```bash
curl -fsS http://localhost/api/health
```
Expected: HTTP 200 and a JSON body with `"status":"ok"`.

Do not commit anything in this task.

---

## Phase 1 — Audit

### Task 1: Produce the code-scan audit report

**Files:**
- Create: `docs/superpowers/audits/2026-04-19-responsive-findings.md`

- [ ] **Step 1: Scan for fixed pixel widths**

Run:
```bash
grep -rnE 'w-\[[0-9]+px\]|h-\[[0-9]+px\]|style=\{\{.*(width|height):' frontend/app frontend/components | grep -v node_modules
```
Capture the output for the report.

- [ ] **Step 2: Scan for unqualified grids and flex rows**

Run:
```bash
grep -rnE 'grid-cols-[2-9]( |")' frontend/app frontend/components | grep -v node_modules | grep -vE '(sm|md|lg|xl):grid-cols'
```
Any match is a page that uses a multi-column grid with no breakpoint qualifier — likely breaks below `sm`.

- [ ] **Step 3: Scan for `<table>` without `overflow-x-auto`**

Run:
```bash
grep -rln '<table' frontend/app | xargs -I{} sh -c 'grep -L "overflow-x-auto" {} && echo "NEEDS-WRAP: {}"'
```

- [ ] **Step 4: Scan for pages with no responsive classes at all**

Run:
```bash
for f in $(find frontend/app -name 'page.tsx'); do
  if ! grep -qE '(sm|md|lg|xl):' "$f"; then
    echo "NO-RESPONSIVE: $f"
  fi
done
```

- [ ] **Step 5: Write the audit report**

Write `docs/superpowers/audits/2026-04-19-responsive-findings.md` with this exact structure:

```markdown
# Responsive Audit Findings — 2026-04-19

Source: spec `docs/superpowers/specs/2026-04-19-responsive-sweep-design.md`.

## Method
Code scan followed by visual verification (pending per-page). Viewport targets: 375px, 768px, 1280px.

## Findings table

| Page | Current state | Symptom < md | Chosen pattern | PR |
|---|---|---|---|---|
| transactions | <summary of table + filters> | <describe> | Card (A) | PR1 |
| forecast-plans | <summary> | <describe> | Hybrid (B) | PR1 |
| budgets | <summary> | <describe> | Hybrid (B) | PR1 |
| recurring | <summary> | <describe> | Card (A) | PR2 |
| accounts | <summary> | <describe> | Card (A) | PR2 |
| categories | <summary> | <describe> | Card (A) | PR2 |
| import | <summary> | <describe> | Form-stack adapted | PR2 |
| login / register / forgot / reset / verify / mfa / setup | <summary> | <describe> | Form-stack (C) | PR2 |
| settings/* | <summary> | <describe> | Form-stack (C) | PR2 |
| admin/settings | <summary> | <describe> | Form-stack (C) | PR2 |
| system/plans | <summary> | <describe> | Form-stack (C) | PR2 |
| dashboard | already responsive | regression only | — | PR2 |

## Raw scan output
(paste the outputs from steps 1–4 here, trimmed to relevant hits)

## Open questions
(any page where the chosen pattern needs reconsideration — leave blank if none)
```

Fill in the `<summary>` and `<describe>` cells by briefly reading each page file (you don't need to parse every line — just enough to say "8-column table, filters in a flex row, no breakpoint qualifiers" or similar).

- [ ] **Step 6: Commit**

Run:
```bash
git add docs/superpowers/audits/2026-04-19-responsive-findings.md
git commit -m "docs: responsive audit findings"
```

---

## Phase 2 — PR1: Data-Table Pages

### Task 2: Transactions page responsive fix

**Files:**
- Modify: `frontend/app/transactions/page.tsx`

- [ ] **Step 1: Read the current page**

Run:
```bash
wc -l frontend/app/transactions/page.tsx
```
Expected: ~639 lines.

Read the full file. Identify:
- The filters/actions bar (usually at the top, multi-column flex or grid)
- The main table (or grid-cols-12 row pattern)
- Any pagination bar at the bottom
- Action buttons per row (edit, delete, settle/unsettle)

- [ ] **Step 2: Apply filter-bar stacking**

Replace the filter bar's wrapper so it is a single column below `sm` and restores its original layout from `sm+`. Example transformation — match the actual markup, don't copy blindly:

```tsx
// Before:
<div className="flex items-center gap-2">
  <input className="w-64 ..." />
  <select className="..." />
  <button className="...">Filter</button>
</div>

// After:
<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
  <input className="w-full sm:w-64 ..." />
  <select className="w-full sm:w-auto ..." />
  <button className="w-full sm:w-auto min-h-[44px] sm:min-h-0 ...">Filter</button>
</div>
```

- [ ] **Step 3: Apply card layout to transactions below `md`**

If the page uses a `<table>`: add `hidden md:table` to the table, and insert a sibling `<div className="md:hidden flex flex-col gap-3">` that maps over the same `transactions` array and renders:

```tsx
<article
  key={tx.id}
  className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"
>
  <div className="flex items-start justify-between gap-2">
    <div className="min-w-0 flex-1">
      <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
        {tx.description}
      </div>
      <div className="mt-0.5 text-xs text-slate-500">
        {formatDate(tx.date)} · {tx.account_name}
      </div>
    </div>
    <div className={`shrink-0 text-right text-sm font-semibold ${tx.amount < 0 ? "text-rose-600" : "text-emerald-600"}`}>
      {formatAmount(tx.amount)}
    </div>
  </div>
  {tx.category_name && (
    <div className="text-xs text-slate-600 dark:text-slate-400">
      {tx.category_name}
    </div>
  )}
  <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
    <button className="min-h-[44px] px-3 rounded ..." onClick={() => startEdit(tx)}>Edit</button>
    <button className="min-h-[44px] px-3 rounded ..." onClick={() => toggleSettled(tx)}>
      {tx.settled ? "Unsettle" : "Settle"}
    </button>
    <button className="min-h-[44px] px-3 rounded text-rose-600 ..." onClick={() => askDelete(tx)}>Delete</button>
  </div>
</article>
```

If the page uses `grid-cols-12` row divs instead of a `<table>`: keep the grid for `md+` by adding `hidden md:grid` to the row container, and render the same card markup above in a `md:hidden` sibling.

- [ ] **Step 4: Fix any inline-edit form to stack on phones**

The edit form (if inline) likely uses `grid-cols-*` with multiple fields per row. Add `grid-cols-1 sm:grid-cols-2` (or the original count) so inputs stack below `sm`. Ensure action buttons are `min-h-[44px]` below `sm`.

- [ ] **Step 5: Start dev server (if not already) and visually verify at 375px**

Navigate via chrome-devtools MCP to `http://localhost/transactions` after logging in. Resize to 375×812. Check:
- No horizontal page scroll.
- Cards render cleanly with amount visible on the right.
- Filter inputs stack full-width.
- All buttons are tappable (≥44px).

Screenshot to `/tmp/responsive-sweep/transactions-375.png`.

- [ ] **Step 6: Visually verify at 768px**

Resize to 768×1024. Confirm the table is visible (cards hidden) and the filter bar is restored to its desktop row layout. Screenshot to `/tmp/responsive-sweep/transactions-768.png`.

- [ ] **Step 7: Regression check at 1280px**

Resize to 1280×800. Confirm no visual regression vs. main. Screenshot to `/tmp/responsive-sweep/transactions-1280.png`.

- [ ] **Step 8: Commit**

Run:
```bash
git add frontend/app/transactions/page.tsx
git commit -m "fix(responsive): transactions card layout below md"
```

---

### Task 3: Forecast Plans page responsive fix (hybrid)

**Files:**
- Modify: `frontend/app/forecast-plans/page.tsx`

- [ ] **Step 1: Read the current page**

Read `frontend/app/forecast-plans/page.tsx`. Identify the main table's columns in order. Typical shape: Category, Planned, Actual, Variance, Source, Actions.

- [ ] **Step 2: Classify columns by priority**

Mark columns as:
- **Always visible:** Category (name), Planned (primary amount), Actions trigger.
- **Visible from `md+`:** Actual, Variance, Source.

- [ ] **Step 3: Apply hide-and-scroll**

On each `<th>` and matching `<td>` for the non-essential columns, add `hidden md:table-cell`:

```tsx
<th className="... hidden md:table-cell">Actual</th>
<th className="... hidden md:table-cell">Variance</th>
<th className="... hidden md:table-cell">Source</th>

{rows.map(r => (
  <tr key={r.id}>
    <td>{r.category}</td>
    <td className="text-right">{fmt(r.planned)}</td>
    <td className="hidden md:table-cell text-right">{fmt(r.actual)}</td>
    <td className="hidden md:table-cell text-right">{fmt(r.variance)}</td>
    <td className="hidden md:table-cell">{r.source}</td>
    <td>{actions}</td>
  </tr>
))}
```

- [ ] **Step 4: Wrap the table in a scroller**

Wrap the `<table>` in `<div className="overflow-x-auto">` and set the table to `min-w-[640px]` so the visible columns never squish under their content.

- [ ] **Step 5: Summary card — show hidden fields inline below `md`**

For each row on phones, show the hidden fields as a secondary line underneath the row so the user still sees Actual/Variance. The simplest implementation: after the Category cell, add a `<div className="md:hidden mt-1 text-xs text-slate-500">` containing the Actual and Variance values. Place this inside the first `<td>`, not a new row.

Example:
```tsx
<td>
  <div>{r.category}</div>
  <div className="md:hidden mt-1 text-xs text-slate-500">
    Actual {fmt(r.actual)} · Variance {fmt(r.variance)}
  </div>
</td>
```

- [ ] **Step 6: Stack filters / headers**

Apply the same filter-bar stacking treatment as Task 2 Step 2 to any header controls on this page.

- [ ] **Step 7: Visually verify at 375px**

Navigate to `http://localhost/forecast-plans`. Resize to 375×812. Check:
- No horizontal page scroll (inside-table horizontal scroll is fine).
- Category and Planned are visible; Actual/Variance appear as the secondary line inline.
- Actions trigger (button or kebab) is tappable.

Screenshot `/tmp/responsive-sweep/forecast-plans-375.png`.

- [ ] **Step 8: Verify at 768 and 1280**

Confirm table fills normally. Screenshot to `/tmp/responsive-sweep/forecast-plans-768.png` and `/tmp/responsive-sweep/forecast-plans-1280.png`.

- [ ] **Step 9: Commit**

Run:
```bash
git add frontend/app/forecast-plans/page.tsx
git commit -m "fix(responsive): forecast plans hybrid table below md"
```

---

### Task 4: Budgets page responsive fix (hybrid)

**Files:**
- Modify: `frontend/app/budgets/page.tsx`

- [ ] **Step 1: Read the current page**

Read `frontend/app/budgets/page.tsx` (~336 lines). Budgets uses expandable rows with inline bar charts and a Transfer action. Identify:
- The outer row layout (grid vs. table vs. stacked divs)
- The expansion area with the bar chart
- Action buttons (Transfer, Edit, Remove)

- [ ] **Step 2: Keep the row structure but reflow internals**

For each budget row below `md`:
- Category name and amount on the first line (flex row, amount right-aligned).
- Bar chart on the second line (full width).
- Action buttons on the third line (wrap with `flex-wrap gap-2`, each button `min-h-[44px]`).

Use `md:flex-row md:items-center` on the outer row container to restore the desktop single-line layout.

- [ ] **Step 3: Expansion area**

If the expansion area has its own grid (e.g. planned vs spent split), add `grid-cols-1 sm:grid-cols-2` to stack on phones.

- [ ] **Step 4: Transfer form fix (if present inline)**

If an inline transfer form exists on this page, apply form-stack rules: single column below `sm`, buttons at least `min-h-[44px]` below `sm`.

- [ ] **Step 5: Visually verify at 375/768/1280**

Navigate to `http://localhost/budgets`. Screenshot at each viewport. Specifically confirm:
- Amounts never overlap category names (a known bug from backlog #29c).
- Transfer/Edit/Remove buttons are all tappable (known bug: "too small to tap").
- Bar charts render at full width below `md`.

Save screenshots under `/tmp/responsive-sweep/budgets-{375,768,1280}.png`.

- [ ] **Step 6: Commit**

Run:
```bash
git add frontend/app/budgets/page.tsx
git commit -m "fix(responsive): budgets row reflow and tap targets below md"
```

---

### Task 5: Card component extraction decision

**Files:**
- Maybe create: `frontend/components/ui/DataCard.tsx`

- [ ] **Step 1: Evaluate**

Task 2 produced one card shape (Transactions). Tasks 3 and 4 produced hybrid rows, not cards. So as of PR1, cards exist in ONE place. Per the DRY trigger (extract at third repetition), **do nothing in this task and leave Transactions inline.** This task exists purely to document that the evaluation was performed.

If, unexpectedly, you found yourself re-implementing the same card shape in both Task 2 and a second PR1 page, extract it now with the props shape:
```ts
type DataCardProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  amount?: React.ReactNode;
  amountTone?: "positive" | "negative" | "neutral";
  meta?: React.ReactNode;
  actions?: React.ReactNode;
};
```

- [ ] **Step 2: If no extraction, commit nothing and move on**

No commit.

---

### Task 6: Fill in the audit report with PR1 visual findings

**Files:**
- Modify: `docs/superpowers/audits/2026-04-19-responsive-findings.md`

- [ ] **Step 1: Update each PR1 row**

For transactions, forecast-plans, budgets: update the `Symptom < md` and any newly-observed issues captured during visual verification. Keep the tone terse.

- [ ] **Step 2: Commit**

Run:
```bash
git add docs/superpowers/audits/2026-04-19-responsive-findings.md
git commit -m "docs: update audit findings with PR1 verification results"
```

---

### Task 7: Open PR1

**Files:** none (GitHub operations only).

- [ ] **Step 1: Push the branch**

Run:
```bash
git push -u origin fix/responsive-sweep-data-tables
```

- [ ] **Step 2: Open the PR**

Run:
```bash
gh pr create --title "fix: responsive sweep — data tables (Transactions, Forecast Plans, Budgets)" --body "$(cat <<'EOF'
## Summary
Part 1 of the responsive sweep (see spec `docs/superpowers/specs/2026-04-19-responsive-sweep-design.md`).

- Transactions: card layout below `md`, table restored from `md+`.
- Forecast Plans: hybrid hide-and-scroll, secondary line shows Actual/Variance inline below `md`.
- Budgets: row reflow (name, chart, actions stacked) below `md`; tap targets bumped to 44px.

## Audit report
See `docs/superpowers/audits/2026-04-19-responsive-findings.md`.

## Screenshots
<attach 375px and 768px screenshots from /tmp/responsive-sweep/>

## Follow-up
PR2 will cover Recurring, Accounts, Categories, Import, all auth/settings/admin forms, the modal sweep, and a dashboard regression check.
EOF
)"
```

- [ ] **Step 3: Attach screenshots**

Upload the six screenshots from `/tmp/responsive-sweep/` into the PR description using the GitHub web UI or `gh pr edit --body-file`. Screenshots do not go into the repo.

---

### Task 8: Wait for PR1 merge

- [ ] **Step 1: Stop here until PR1 is merged**

Do not start Phase 3 until the user confirms PR1 is merged into main. The PR2 branch must be cut from main-post-PR1.

---

## Phase 3 — PR2: Remaining Pages

### Task 9: Cut PR2 branch

**Files:** none.

- [ ] **Step 1: Sync main**

Run:
```bash
git checkout main
git pull --ff-only
```

- [ ] **Step 2: Create PR2 branch**

Run:
```bash
git checkout -b fix/responsive-sweep-remaining
```

---

### Task 10: Recurring page

**Files:**
- Modify: `frontend/app/recurring/page.tsx`

- [ ] **Step 1: Apply the same card pattern used in Transactions (Task 2 Step 3)**

Fields in each card: description, next occurrence date, cadence, amount (right-aligned, colored), account, category, action buttons (Edit, Delete, Skip-next if applicable). Table retained for `md+`.

- [ ] **Step 2: Stack filter/create controls below `sm`**

Same treatment as Task 2 Step 2.

- [ ] **Step 3: Visual verify at 375/768/1280**

Screenshots to `/tmp/responsive-sweep/recurring-{375,768,1280}.png`.

- [ ] **Step 4: Commit**

Run:
```bash
git add frontend/app/recurring/page.tsx
git commit -m "fix(responsive): recurring card layout below md"
```

---

### Task 11: Accounts page

**Files:**
- Modify: `frontend/app/accounts/page.tsx`

- [ ] **Step 1: Apply card pattern**

Fields per card: account name, type, currency, balance (right-aligned, colored on negative), default badge, action row (Edit, Default, Deactivate, Delete) — known bug: these overlap on mobile, so wrap `flex-wrap gap-2` with 44px tap heights.

- [ ] **Step 2: Evaluate extraction**

This is the second page using the exact transactions-style card. Still below the three-repetition threshold — keep inline.

- [ ] **Step 3: Visual verify at 375/768/1280**

Screenshots to `/tmp/responsive-sweep/accounts-{375,768,1280}.png`.

- [ ] **Step 4: Commit**

Run:
```bash
git add frontend/app/accounts/page.tsx
git commit -m "fix(responsive): accounts card layout below md"
```

---

### Task 12: Categories page & extraction check

**Files:**
- Modify: `frontend/app/categories/page.tsx`
- Maybe create: `frontend/components/ui/DataCard.tsx`

- [ ] **Step 1: Read the page**

Categories is a two-level tree (masters and subcategories). A full card may be overkill. Try the simpler approach first:
- Below `md`, ensure the tree rows use `flex flex-wrap gap-2` with the label taking priority and buttons wrapping to a second line.
- Tap targets ≥44px.
- Add horizontal padding so touch targets don't hug the edge.

- [ ] **Step 2: Extraction decision**

If Tasks 2, 10, and 11 all ended up building the same inline card shape, extract now:

Create `frontend/components/ui/DataCard.tsx`:

```tsx
import type { ReactNode } from "react";

export type DataCardProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  amount?: ReactNode;
  amountTone?: "positive" | "negative" | "neutral";
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

const toneClass: Record<NonNullable<DataCardProps["amountTone"]>, string> = {
  positive: "text-emerald-600",
  negative: "text-rose-600",
  neutral: "text-slate-900 dark:text-slate-100",
};

export function DataCard({
  title,
  subtitle,
  amount,
  amountTone = "neutral",
  meta,
  actions,
  className = "",
}: DataCardProps) {
  return (
    <article
      className={`flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {title}
          </div>
          {subtitle && (
            <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>
          )}
        </div>
        {amount !== undefined && (
          <div className={`shrink-0 text-right text-sm font-semibold ${toneClass[amountTone]}`}>
            {amount}
          </div>
        )}
      </div>
      {meta && <div className="text-xs text-slate-600 dark:text-slate-400">{meta}</div>}
      {actions && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          {actions}
        </div>
      )}
    </article>
  );
}
```

Then refactor Transactions (Task 2), Recurring (Task 10), and Accounts (Task 11) to use `<DataCard>` in their `md:hidden` sections. Each refactor is a small drop-in: replace the inline `<article>` with `<DataCard ... />`.

- [ ] **Step 3: If extracted, re-verify each affected page visually at 375px**

One screenshot per page is enough; compare against the pre-extraction screenshots from Tasks 2/10/11.

- [ ] **Step 4: Visual verify Categories at 375/768/1280**

Screenshots to `/tmp/responsive-sweep/categories-{375,768,1280}.png`.

- [ ] **Step 5: Commit**

Run:
```bash
git add frontend/app/categories/page.tsx
# if extraction happened, also:
# git add frontend/components/ui/DataCard.tsx frontend/app/transactions/page.tsx frontend/app/recurring/page.tsx frontend/app/accounts/page.tsx
git commit -m "fix(responsive): categories reflow and DataCard extraction"
```

If no extraction, use `"fix(responsive): categories reflow below md"` instead.

---

### Task 13: Import wizard

**Files:**
- Modify: `frontend/app/import/page.tsx`

- [ ] **Step 1: Read the page and identify wizard steps**

Import is a multi-step flow (upload → map columns → preview → confirm). Identify each step container.

- [ ] **Step 2: Stack step indicators below `sm`**

If there's a horizontal step indicator using `flex`, add `flex-col sm:flex-row` so steps stack on phones. If the indicator has connectors (lines between steps), switch them to vertical on phones or hide them.

- [ ] **Step 3: Map/preview table**

The column-mapping step likely has a table of CSV columns → target fields. Apply Pattern B (hide-and-scroll) — keep the table, make it `overflow-x-auto` with `min-w-[640px]`.

The preview step (showing rows that will be imported) also uses Pattern B.

- [ ] **Step 4: Action buttons**

Back / Continue / Cancel buttons should be `min-h-[44px]` below `sm` and arranged in a `flex flex-col-reverse sm:flex-row sm:justify-end gap-2` (primary action on top in mobile stack).

- [ ] **Step 5: Visual verify at 375/768/1280**

Screenshots to `/tmp/responsive-sweep/import-{375,768,1280}.png`.

- [ ] **Step 6: Commit**

Run:
```bash
git add frontend/app/import/page.tsx
git commit -m "fix(responsive): import wizard stacking below sm"
```

---

### Task 14: Auth pages sweep

**Files:**
- Modify: `frontend/app/login/page.tsx`
- Modify: `frontend/app/register/page.tsx`
- Modify: `frontend/app/forgot-password/page.tsx`
- Modify: `frontend/app/reset-password/page.tsx`
- Modify: `frontend/app/verify-email/page.tsx`
- Modify: `frontend/app/mfa-verify/page.tsx`
- Modify: `frontend/app/setup/page.tsx`

- [ ] **Step 1: For each page, apply form-stack**

These pages are already mostly responsive (centered auth card), but check and apply:
- Outer container: `min-h-screen flex items-center justify-center px-4 py-8`.
- Card: `w-full max-w-md` (unchanged on desktop, full width with 1rem padding on phones).
- Any multi-column forms (e.g., register's first-name/last-name pair): `grid grid-cols-1 sm:grid-cols-2 gap-3`.
- Submit buttons: `w-full min-h-[44px]`.

Apply to each of the seven pages. Most will need only 1–3 small class tweaks; a few may already be correct.

- [ ] **Step 2: Visual verify at 375px only**

One screenshot per page at 375px is enough — auth pages are narrow by design, so 768 and 1280 don't vary meaningfully. Save to `/tmp/responsive-sweep/auth-<page>-375.png`.

- [ ] **Step 3: Commit**

Run:
```bash
git add frontend/app/login/page.tsx frontend/app/register/page.tsx frontend/app/forgot-password/page.tsx frontend/app/reset-password/page.tsx frontend/app/verify-email/page.tsx frontend/app/mfa-verify/page.tsx frontend/app/setup/page.tsx
git commit -m "fix(responsive): auth pages form-stack below sm"
```

---

### Task 15: Settings pages sweep

**Files:**
- Modify: `frontend/app/settings/page.tsx`
- Modify: `frontend/app/settings/billing/page.tsx`
- Modify: `frontend/app/settings/organization/page.tsx`
- Modify: `frontend/app/settings/security/page.tsx`
- Modify: `frontend/components/SettingsLayout.tsx`

- [ ] **Step 1: Fix SettingsLayout tabs for phones**

Read `frontend/components/SettingsLayout.tsx`. The tab bar likely uses a horizontal `flex` with pills/underlines. On phones it can overflow invisibly. Apply:
```tsx
<nav className="flex gap-1 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
  {/* tabs */}
</nav>
```
The negative margin + padding trick lets the tabs extend to the viewport edge on phones while preserving visual padding.

- [ ] **Step 2: For each settings page, apply form-stack**

- Any `grid-cols-2`/`grid-cols-3` inside a settings card → add `grid-cols-1 sm:grid-cols-2` (or similar) so fields stack below `sm`.
- Submit/action buttons: `w-full min-h-[44px] sm:w-auto`.
- Card header rows (title + action button): `flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`.

- [ ] **Step 3: Billing page specifically**

The billing page shows plan comparison cards. Make sure they're `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` (or appropriate) so they stack on phones.

- [ ] **Step 4: Security page specifically**

The security page has password change + MFA setup sections. The MFA QR code area must stay centered and within viewport on phones.

- [ ] **Step 5: Visual verify at 375 and 768 for each page**

Five pages × two viewports = 10 screenshots. Name them `/tmp/responsive-sweep/settings-<page>-<viewport>.png`.

- [ ] **Step 6: Commit**

Run:
```bash
git add frontend/app/settings/page.tsx frontend/app/settings/billing/page.tsx frontend/app/settings/organization/page.tsx frontend/app/settings/security/page.tsx frontend/components/SettingsLayout.tsx
git commit -m "fix(responsive): settings pages and tab bar below sm"
```

---

### Task 16: Admin & system pages

**Files:**
- Modify: `frontend/app/admin/settings/page.tsx`
- Modify: `frontend/app/system/plans/page.tsx`
- Modify: `frontend/app/profile/page.tsx`

- [ ] **Step 1: admin/settings and profile are 12-line stubs**

Read both files. They are likely just redirects or thin pages. If they render nothing meaningful, no change needed — skip.

- [ ] **Step 2: system/plans is a CRUD page**

Apply Pattern B (hide-and-scroll) to the plans table. Stack the "Create plan" form section using form-stack rules.

- [ ] **Step 3: Visual verify system/plans at 375/768/1280**

Screenshots to `/tmp/responsive-sweep/system-plans-{375,768,1280}.png`.

- [ ] **Step 4: Commit**

Run:
```bash
git add frontend/app/system/plans/page.tsx
# only add admin/profile if actually modified
git commit -m "fix(responsive): system plans hybrid table below md"
```

---

### Task 17: Modal sweep

**Files:**
- Modify: `frontend/components/ui/ConfirmModal.tsx`
- Modify: any inline modals found across pages

- [ ] **Step 1: Harden ConfirmModal**

Read `frontend/components/ui/ConfirmModal.tsx`. Ensure the shell:
- Outer overlay: `fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50`.
- Inner panel: `w-full max-w-md max-h-[90vh] overflow-y-auto max-w-[calc(100vw-2rem)]`.
- Footer buttons: `flex flex-col-reverse sm:flex-row sm:justify-end gap-2`, each button `w-full sm:w-auto min-h-[44px]`.

Apply whatever subset is missing.

- [ ] **Step 2: Find other modals**

Run:
```bash
grep -rln 'role="dialog"\|aria-modal\|fixed inset-0' frontend/app frontend/components
```

For each match that isn't `ConfirmModal`, open the file and apply the same containment rules.

- [ ] **Step 3: Visual verify a representative modal on a phone viewport**

Open the app at 375px, trigger a confirm dialog (e.g., delete a transaction). Confirm:
- Modal is centered, has 1rem breathing room on each side.
- Body scrolls if content exceeds `90vh`.
- Both buttons are visible without scrolling the modal itself.

Screenshot to `/tmp/responsive-sweep/modal-confirm-375.png`.

- [ ] **Step 4: Commit**

Run:
```bash
git add frontend/components/ui/ConfirmModal.tsx
# add any inline-modal files you modified
git commit -m "fix(responsive): modal containment at small viewports"
```

---

### Task 18: Dashboard regression check

**Files:**
- Possibly modify: `frontend/app/dashboard/page.tsx`

- [ ] **Step 1: Visual check at 375/768/1280**

Navigate to `http://localhost/dashboard` after login. Resize through the three viewports. Confirm:
- No horizontal scroll at 375.
- Chart cards wrap cleanly.
- Tap targets on the account balance list are ≥44px.

Screenshots to `/tmp/responsive-sweep/dashboard-{375,768,1280}.png`.

- [ ] **Step 2: Fix only if regression is found**

If any regression appears (e.g., PR1's changes affected a shared component that dashboard also uses), fix the specific broken element. If everything is clean, skip to Step 3.

- [ ] **Step 3: Commit (if there were fixes)**

Run:
```bash
git add frontend/app/dashboard/page.tsx
git commit -m "fix(responsive): dashboard regression cleanup"
```

If no fixes, no commit.

---

### Task 19: Open PR2

**Files:** none.

- [ ] **Step 1: Push the branch**

Run:
```bash
git push -u origin fix/responsive-sweep-remaining
```

- [ ] **Step 2: Open the PR**

Run:
```bash
gh pr create --title "fix: responsive sweep — remaining pages, forms, modals" --body "$(cat <<'EOF'
## Summary
Part 2 of the responsive sweep. Completes the app-wide pass started in PR1.

- Card pattern: Recurring, Accounts, Categories (+ optional `DataCard` extraction).
- Hybrid hide-and-scroll: Import wizard table, System Plans.
- Form-stack: all auth pages, all settings pages, SettingsLayout tab bar.
- Modal containment: ConfirmModal and any inline modals.
- Dashboard regression check passed.

## Audit report
See `docs/superpowers/audits/2026-04-19-responsive-findings.md` (committed in PR1).

## Screenshots
<attach screenshots from /tmp/responsive-sweep/>
EOF
)"
```

- [ ] **Step 3: Attach screenshots via PR description**

Use the GitHub web UI to drop the screenshots into the PR body.

---

## Phase 4 — Close out

### Task 20: Update roadmap memory after PR2 merges

**Files:** memory system (no repo files).

- [ ] **Step 1: Once PR2 is merged, update memory**

Update `project_ui_improvements.md` to mark item #29 (mobile responsive for data-heavy pages) as DONE with reference to both PRs. Confirm there are no remaining open mobile-specific items.

No repo commit — this is memory-only.

---

## Self-Review Checklist (run before handing off)

1. **Spec coverage:** every success criterion in the spec is verified in at least one task step? ✔
2. **Placeholders:** no TBDs, TODOs, "add appropriate X"? ✔
3. **Type consistency:** `DataCard` props referenced identically in Tasks 12 and any card refactors? ✔
4. **PR boundary clarity:** Task 8 pauses until PR1 merges; Task 9 is the single place where PR2's branch is cut? ✔
