# AuthProvider discriminated mode machine

Status: DESIGN (Team G, 2026-05-17). Implementation lands after Team E (Google SSO disclosure) and Team F (frontend auth P0) merge, to avoid AuthProvider conflicts.

## 1. Current state shape

File: `frontend/components/auth/AuthProvider.tsx` (post `b0bffdd`).

```ts
interface AuthContextValue {           // lines 20-35
  user: User | null;                   // line 21
  loading: boolean;                    // line 22
  needsSetup: boolean;                 // line 23
  login: (...) => Promise<void>;       // line 24
  register: (...) => Promise<void>;    // line 25
  logout: () => Promise<void>;         // line 33
  refreshMe: () => Promise<void>;      // line 34
}
```

Internal `useState` triplet (lines 40-42):

```ts
const [user, setUser] = useState<User | null>(null);
const [loading, setLoading] = useState(true);
const [needsSetup, setNeedsSetup] = useState(false);
```

Semantic ambiguity these three booleans / scalars produce today:

1. `loading=true, user=null, needsSetup=false` overloads three real situations:
   a. Provider just mounted, refresh has not been attempted yet (`setup`).
   b. Refresh is in flight (`restoring`).
   c. Refresh failed transiently and we have not retried (impossible to express; the `finally` on line 76 flips `loading=false` and the state collapses to "unauthenticated" even though Team F's discriminated `RefreshResult` now distinguishes `terminal` from `transient`).
2. `loading=false, user=null, needsSetup=false` overloads two real situations:
   a. Genuinely unauthenticated (`unauthenticated`, redirect to /login).
   b. Transient refresh failure post-mount (e.g. network blip while AppShell is mounted). Today AppShell line 152 redirects to `/login` immediately, which is the bug class #287 set out to fix at the api.ts layer but only partially propagates to the provider.
3. `needsSetup` is independent of `user`/`loading` in the type, but in practice only `needsSetup=true, user=null, loading=false` is meaningful; the other 7 combinations are unreachable yet not enforced.
4. The `auth:unauthenticated` event handler (lines 84-91) collapses session state imperatively; there is no record of whether the collapse came from a terminal refresh failure (api.ts line 199) or from `logout()` (lines 131-139). Consumers cannot tell "you were just logged out" from "your session expired".

## 2. Proposed discriminated mode model

```ts
// Discriminator: AuthMode["mode"] is the source of truth.
// Every other field is only present in the variants where it is meaningful.
export type AuthMode =
  // Pre-hydration. The provider has mounted but has not yet attempted
  // any network call. Render-blocking; nothing should redirect off this.
  | { mode: "setup" }

  // Silent refresh + /me in flight on mount, or /status check still
  // pending. Renders the same shell-spinner UI as `setup` today.
  | { mode: "restoring" }

  // First-app-startup: backend's /api/v1/auth/status returned
  // { needs_setup: true }. /setup is the only legal route in this mode.
  | { mode: "needs_setup" }

  // Logged in, access token in memory, user object loaded.
  | { mode: "authenticated"; user: User; sessionId: string }

  // Confirmed no session. The ONLY mode that triggers redirect to /login.
  // Reached via: terminal refresh failure, explicit logout, or initial
  // refresh attempt completed with a clean negative.
  | { mode: "unauthenticated"; reason: "logout" | "expired" | "never_authenticated" }

  // Refresh attempt returned RefreshResult { ok: false, kind: "transient" }.
  // Session MAY still be alive (refresh cookie still valid). Render the
  // last-known user shell if we had one (`lastUser`) and show a passive
  // retry banner; do NOT redirect. A successful retry transitions to
  // `authenticated`; a terminal failure transitions to `unauthenticated`.
  | {
      mode: "transient_error";
      lastUser: User | null;
      attempt: number;       // increments on each retry while in this mode
      lastError: string;     // human-readable, sourced from ApiResponseError
      since: number;         // Date.now() when we first entered transient_error
    };
```

### Optional sub-state: SSO first-run disclosure (Team E)

Two viable shapes; Team G's recommendation is **B (user metadata)**:

- **A. Mode sub-state:** add `| { mode: "awaiting_disclosure"; user: User }` between `authenticated` and any consumer that gates on `user`. Pro: forces every consumer to acknowledge the disclosure. Con: every existing route component (~35 callers) needs a new branch; blast radius is exactly the wrong shape for a one-screen modal.
- **B. User-metadata flag (recommended):** Team E adds `User.requires_sso_disclosure: boolean` (or a deterministic computed boolean) to the `/me` payload. AuthProvider stays in `authenticated` mode; an island component near the top of AppShell renders the disclosure modal when the flag is true and clears it via a one-shot mutation. This is the same pattern `onboarded_at` already uses (AppShell.tsx lines 161-168) and the same pattern `email_verified` uses on the gate banner. Blast radius is one new component, not the whole consumer set.

Decision should be confirmed with Team E during their PR review; this spec assumes **B**.

## 3. State transitions

Legal transitions (`from -> trigger -> to`):

| From | Trigger | To |
| --- | --- | --- |
| `setup` | provider effect runs (mount) | `restoring` |
| `restoring` | `/auth/status` returns `needs_setup=true` | `needs_setup` |
| `restoring` | `/auth/refresh` returns `RefreshResult { ok: true }` + `/me` succeeds | `authenticated` |
| `restoring` | `/auth/refresh` returns `RefreshResult { ok: false, kind: "terminal" }` | `unauthenticated { reason: "never_authenticated" }` |
| `restoring` | `/auth/refresh` returns `RefreshResult { ok: false, kind: "transient" }` | `transient_error { lastUser: null, attempt: 1 }` |
| `restoring` | `/me` succeeds after refresh | `authenticated` |
| `restoring` | `/me` 401 + retry refresh terminal | `unauthenticated { reason: "expired" }` |
| `needs_setup` | `register()` + `login()` succeed | `authenticated` |
| `authenticated` | `apiFetch` 401 + refresh terminal (event `auth:unauthenticated`) | `unauthenticated { reason: "expired" }` |
| `authenticated` | `apiFetch` 401 + refresh transient | `transient_error { lastUser: user }` |
| `authenticated` | `logout()` resolves (or fails best-effort) | `unauthenticated { reason: "logout" }` |
| `authenticated` | `refreshMe()` 401 + refresh terminal | `unauthenticated { reason: "expired" }` |
| `authenticated` | `refreshMe()` 401 + refresh transient | `transient_error { lastUser: user }` |
| `transient_error` | scheduled retry succeeds (`/me` returns user) | `authenticated` |
| `transient_error` | scheduled retry returns terminal | `unauthenticated { reason: "expired" }` |
| `transient_error` | manual retry button -> success | `authenticated` |
| `transient_error` | manual retry button -> terminal | `unauthenticated { reason: "expired" }` |
| `unauthenticated` | `login()` succeeds | `authenticated` |
| `unauthenticated` | `register()` succeeds (followed by login) | `authenticated` |

Illegal transitions (the reducer asserts and a structured warning is logged; do not throw, do not silently no-op):

| From | Trigger | Why illegal |
| --- | --- | --- |
| `setup` | any token / user mutation | We have not attempted hydration; ignore. |
| `needs_setup` | `auth:unauthenticated` event | Pre-bootstrap; nobody to log out. |
| `unauthenticated` | `auth:unauthenticated` event | Already terminal. No-op, no log. |
| `transient_error` | second `auth:unauthenticated` event mid-retry | Coalesce: retry pipeline owns the resolution. |
| `authenticated` | `setMode("setup")` or `setMode("restoring")` | Only logout/refresh failure may demote; never silently restart. |

## 4. Integration contract with Team F's api.ts changes

`frontend/lib/api.ts` already lands the discriminated `RefreshResult` (lines 7-10) plus the terminal/transient split in `apiFetch` (lines 188-213). The provider's job is to subscribe to those signals and produce the mode.

Three dispatch sites to wire:

1. **Terminal refresh inside `apiFetch`** (lines 188-201):

   ```ts
   } else if (refreshResult.kind === "terminal") {
     ...
     if (!isCredCheck) {
       accessToken = null;
       if (typeof window !== "undefined") {
         window.dispatchEvent(new Event("auth:unauthenticated"));
       }
     }
   ```

   Provider listener (today AuthProvider.tsx lines 84-91) maps this to `{ mode: "unauthenticated", reason: "expired" }`. We extend the event to carry a `CustomEvent<{ reason: "expired" }>` payload so the listener does not have to guess, and so `logout()` can dispatch the same event with `reason: "logout"` for a single code path.

2. **Transient refresh inside `apiFetch`** (lines 203-213):

   ```ts
   throw new ApiResponseError(
     503,
     "Session refresh temporarily unavailable. Please try again.",
     "refresh_transient",
     refreshResult.error.message,
   );
   ```

   Today this throws and the caller (SWR / a page) sees a 503. The provider does not learn about it. Add a parallel dispatch:

   ```ts
   window.dispatchEvent(new CustomEvent("auth:transient", {
     detail: { error: refreshResult.error.message }
   }));
   ```

   Provider listener maps to `{ mode: "transient_error", lastUser, attempt, ... }`. The `apiFetch` caller still gets the 503 throw for its own retry semantics; the dispatch is purely so the provider can render the banner.

3. **Logout** (AuthProvider.tsx lines 131-139): same `auth:unauthenticated` event with `reason: "logout"`. Today logout mutates state directly; we route it through the reducer for symmetry.

Failure mode matrix:

| `apiFetch` outcome | Event dispatched | Provider mode |
| --- | --- | --- |
| Success (any 2xx) | none | unchanged |
| 401 -> refresh ok -> retry ok | none | `authenticated` (unchanged) |
| 401 -> refresh ok -> retry 4xx/5xx | none (caller handles) | `authenticated` (unchanged) |
| 401 -> refresh terminal | `auth:unauthenticated { reason: "expired" }` | `unauthenticated` |
| 401 -> refresh transient | `auth:transient { error }` | `transient_error` |
| Network error on primary request (no 401) | none | unchanged (caller's problem) |

## 5. Integration contract with Team E's first-run SSO disclosure

Per section 2 the recommended shape is a User-metadata flag, not a mode sub-state. The contract is:

1. Backend `/api/v1/auth/me` adds a boolean (working name `requires_sso_disclosure`).
2. The `User` type in `frontend/lib/types.ts` gains the boolean (optional, with the same forward-compat semantics as `permissions?` and `onboarded_at?`).
3. AuthProvider does not look at this field. It stays in `authenticated`.
4. A new island component (`SsoDisclosureGate`, Team E's deliverable) mounted near `AppShell`'s root reads `user.requires_sso_disclosure`, renders the modal when true, and on accept calls a new `POST /api/v1/auth/sso/disclosure/ack` followed by `refreshMe()` to clear the flag.
5. The disclosure is non-blocking with respect to mode transitions; e.g. an `auth:transient` event during the disclosure still flips the provider into `transient_error`, the modal stays mounted, the user can still acknowledge once `authenticated` returns.

If Team E pushes back and wants the disclosure to be modal-blocking with respect to other auth events, we re-open this and move to **A (mode sub-state)**. We do not commit to either now beyond "the mode machine does not own it".

## 6. Backwards-compat plan

### Existing `useAuth()` consumers (38 sites across 35 distinct files)

Pages / app-router entry points that read `{ user, loading }`:

- `frontend/app/dashboard/page.tsx:103`
- `frontend/app/transactions/page.tsx:69`
- `frontend/app/accounts/page.tsx:20`
- `frontend/app/budgets/page.tsx:21`
- `frontend/app/categories/page.tsx:80`
- `frontend/app/recurring/page.tsx:24`
- `frontend/app/mfa-verify/page.tsx:26`
- `frontend/app/admin/page.tsx:268`
- `frontend/app/admin/roles/page.tsx:214`
- `frontend/app/admin/roles/[id]/page.tsx:31`
- `frontend/app/admin/orgs/page.tsx:45`
- `frontend/app/admin/orgs/[id]/page.tsx:76`
- `frontend/app/admin/subscriptions/page.tsx:172`
- `frontend/app/admin/subscriptions/[id]/page.tsx:110`
- `frontend/app/admin/audit/page.tsx:37`
- `frontend/app/admin/users/page.tsx:114`
- `frontend/app/admin/users/[user_id]/page.tsx:73`
- `frontend/app/admin/analytics/page.tsx:113`
- `frontend/app/system/page.tsx:33`
- `frontend/app/system/plans/page.tsx:40`

Pages that read `{ user, refreshMe }` only:

- `frontend/app/settings/page.tsx:37`
- `frontend/app/auth/google/callback/page.tsx:10`
- `frontend/app/verify-email/page.tsx:14`

Pages that read `{ user, loading, refreshMe }`:

- `frontend/app/settings/organization/page.tsx:37`
- `frontend/app/settings/billing/page.tsx:23`

Page that reads `{ user, login, refreshMe }`:

- `frontend/app/settings/security/page.tsx:64`

Page that reads `{ needsSetup, loading, register, login }`:

- `frontend/app/setup/page.tsx:17`

Layout / shell components:

- `frontend/components/AppShell.tsx:142` reads `{ user, loading, logout }` and owns the `/login` redirect (line 152).
- `frontend/components/SettingsLayout.tsx:17` reads `{ user, loading }`.

Other components reading `{ user, loading, needsSetup }`:

- `frontend/components/auth/LoginPageBody.tsx:39` reads `{ user, login, loading, needsSetup }`.
- `frontend/components/auth/RegisterPageBody.tsx:26` reads `{ user, register, loading }`.
- `frontend/components/landing/LandingAuthRedirect.tsx:12` reads `{ user, loading, needsSetup }`.

Components reading `{ refreshMe }` only:

- `frontend/components/auth/AcceptInviteBody.tsx:25`
- `frontend/components/settings/RestartTourCard.tsx:32`

Components reading `{ user }` only:

- `frontend/components/feedback/FeedbackTrigger.tsx:20`

Onboarding entry point reading `{ user, loading, refreshMe }`:

- `frontend/components/onboarding/OnboardingPageBody.tsx:58`

Out-of-band:

- `frontend/components/auth/AuthProviderApex.tsx:23` is the apex-build stub; mirror the new context value shape (return `{ mode: "unauthenticated", reason: "never_authenticated", login, register, logout, refreshMe, user: null, loading: false, needsSetup: false }`) so the apex bundle keeps type-checking.

### Migration shape: additive in PR 1

The cheapest migration is **additive**: introduce `mode` as a new field on `AuthContextValue` while keeping `user`, `loading`, `needsSetup` as before. The reducer maintains both; consumers move one at a time. Concretely:

```ts
interface AuthContextValue {
  // Existing, derived from `mode`, kept stable for callers
  user: User | null;
  loading: boolean;
  needsSetup: boolean;

  // New: discriminated mode (preferred for new callers, AppShell, login,
  // landing, setup)
  mode: AuthMode;

  login: (...) => Promise<void>;
  register: (...) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}
```

Derivation rules in the provider:

- `user = mode.mode === "authenticated" ? mode.user : mode.mode === "transient_error" ? mode.lastUser : null`
- `loading = mode.mode === "setup" || mode.mode === "restoring"`
- `needsSetup = mode.mode === "needs_setup"`

This is what lets us migrate AppShell / LandingAuthRedirect / LoginPageBody / setup / RegisterPageBody (the eight `needsSetup`/redirect-driving consumers) without touching the other 27.

## 7. Test plan

### Unit tests for the reducer

Pure-function reducer with table-driven cases:

1. Each row in section 3's legal-transitions table -> one test asserting `reducer(prev, action)` returns the expected mode.
2. Each row in section 3's illegal-transitions table -> one test asserting `reducer(prev, action) === prev` and that `console.warn` (or `structlog`-flavoured logger if FE has one wired) is called once with a structured payload.
3. Round-trip: starting in `setup`, fire the canonical happy-path sequence (`MOUNT`, `STATUS_OK_AUTHED`, `REFRESH_OK`, `ME_OK { user }`) and assert terminal mode is `authenticated`.
4. Round-trip: starting in `setup`, fire the canonical needs-setup sequence (`MOUNT`, `STATUS_NEEDS_SETUP`) and assert terminal mode is `needs_setup`.
5. Round-trip: starting in `authenticated`, fire `TRANSIENT_REFRESH` then `RETRY_OK { user }` and assert terminal mode is `authenticated` with original `user`.
6. Round-trip: starting in `authenticated`, fire `TRANSIENT_REFRESH` then `RETRY_TERMINAL` and assert terminal mode is `unauthenticated { reason: "expired" }` with `lastUser` discarded.

### Integration tests at the consumer level

Use `frontend/tests/components/landing/LandingAuthRedirect.test.tsx` as the template; add cases against the new mode field. New tests in `frontend/tests/components/auth/AuthProvider.test.tsx`:

1. AppShell does NOT redirect when mode is `transient_error` (regression guard for the false-logout class #287 fixed at the api.ts layer).
2. AppShell DOES redirect when mode is `unauthenticated`.
3. LandingAuthRedirect routes to `/setup` when mode is `needs_setup`, to `/dashboard` when mode is `authenticated`, and stays on landing when mode is `restoring` or `setup` (no flash-of-redirect).
4. `auth:transient` event flips mode to `transient_error` without clearing `lastUser`.
5. `auth:unauthenticated { reason: "expired" }` event flips mode to `unauthenticated` and clears `lastUser`.
6. `logout()` flips mode to `unauthenticated { reason: "logout" }`.

### Type-level tests

Add a `frontend/tests/types/auth-mode.test-d.ts` (or inline in the unit-test file) that exhaustively switches on `mode.mode` and asserts the discriminated union narrows correctly (`@ts-expect-error` on the wrong field per branch).

## 8. Implementation phasing

**Recommendation: 2 PRs, not 1 and not 3.**

- **PR 1 (Team G implementation PR, after E + F merge):** introduce the reducer + `AuthMode` type, expose `mode` alongside the existing `user/loading/needsSetup` fields, wire the new `auth:transient` event, route logout through the reducer, mirror the new shape in `AuthProviderApex.tsx`. Migrate the four consumers whose bugs motivated this work: AppShell (transient_error must not redirect), LandingAuthRedirect (cleaner setup-vs-authenticated split), LoginPageBody, setup/page.tsx. Leave the other 31 consumers on the legacy fields.

- **PR 2 (a few days later, after PR 1 has run in production for one full deploy cycle):** migrate the remaining 31 consumers; remove `loading`, `needsSetup`, and the public `user` field on `AuthContextValue` (or keep `user` as a stable derived alias indefinitely; the savings from removing it are tiny and the churn is large). Codemod-style PR.

A 3-PR split (introduce -> migrate -> delete booleans) is overkill given the consumer set is well-enumerated and `tsc --noEmit` catches every leftover.

A 1-PR split is rejected because it touches 35 files and is impossible to roll back cleanly if a consumer branch has the wrong narrowing.

## 9. Risks

1. **Event-bus coupling.** The provider learns about transient failures through a window event dispatched from `api.ts`. If the dispatch site is missed (e.g. someone adds a new refresh path), the provider never enters `transient_error` and we regress to the pre-#287 false-logout class. Mitigation: a single helper in `api.ts` (`emitAuthEvent`) and a convention test that greps for `dispatchEvent.*auth:` outside that helper.

2. **Retry-budget ownership.** `transient_error` carries `attempt` and `since`, but the actual retry scheduler currently lives inside `apiFetch` (Team F's territory). If Team F's retry budget exhausts and emits a terminal event, the provider must coalesce the events in arrival order. The reducer's `transient_error -> unauthenticated` transition assumes the terminal event wins; if Team F's retry scheduler races a `refreshMe()` call from a consumer (e.g. RestartTourCard), the provider may see `authenticated` then `unauthenticated` then `authenticated` in quick succession. Mitigation: the reducer ignores stale `auth:transient` events whose `since` is older than the current mode's `since`.

3. **SSR / hydration.** AuthProvider is a client component (`"use client"`), but `mode: "setup"` is the SSR-rendered value. Any page that uses `mode` server-side will see `setup` and render the spinner, which is the same behavior `loading=true` gives today. No regression, but worth a hydration-mismatch test on the landing route.

4. **Apex stub drift.** `AuthProviderApex.tsx` already drifts (its return shape includes `refresh` not `refreshMe`, see line 37). The mode-machine PR must update the stub to mirror the new shape exactly, and a CI check should `tsc --noEmit -p next.config.apex.ts` to catch future drift.

5. **Team E timing.** If Team E lands `requires_sso_disclosure` before Team G's implementation PR, Team G's PR pulls in the type. If after, Team E adds a one-line field to `User`. Either order works; the mode machine does not block on it.

6. **Team F shape conflict.** If Team F's anticipated changes introduce more than two refresh outcomes (e.g. `kind: "transient" | "rate_limited" | "maintenance"`), the `transient_error` mode payload may need a `subkind` discriminator. Today's spec uses a single bucket because `api.ts` lines 88-127 only produce `terminal` and `transient`. We do not pre-design subkinds; we extend in PR 3 if and when Team F splits.
