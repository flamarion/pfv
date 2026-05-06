import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import DashboardPage from "@/app/dashboard/page";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("@/components/auth/AuthProvider", async () => {
  const actual = await vi.importActual<typeof import("@/components/auth/AuthProvider")>(
    "@/components/auth/AuthProvider",
  );
  return {
    ...actual,
    useAuth: vi.fn(),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

const stableRouter = { push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => stableRouter,
  usePathname: () => "/dashboard",
}));

const USER = {
  id: 1,
  username: "u",
  email: "u@x.io",
  first_name: null,
  last_name: null,
  phone: null,
  avatar_url: null,
  email_verified: true,
  role: "owner",
  org_id: 1,
  org_name: "Acme",
  billing_cycle_day: 1,
  is_superadmin: false,
  is_active: true,
  mfa_enabled: false,
  subscription_status: null,
  subscription_plan: null,
  trial_end: null,
};

// One transaction in the visible list, settled — used as the click target
// for the status toggle. Its description is the button's aria-label suffix.
const SETTLED_TX = {
  id: 999,
  account_id: 10,
  amount: "50.00",
  type: "expense",
  status: "settled",
  date: "2026-05-01",
  description: "Coffee",
  category_id: null,
  category_name: null,
  account_name: "Amex Primary",
  currency: "EUR",
  linked_transaction_id: null,
  is_imported: false,
  settled_date: "2026-05-01",
};

describe("DashboardPage — pending refetch on status toggle (L3.4)", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    window.history.pushState({}, "", "/dashboard");
    vi.mocked(useAuth).mockReturnValue({
      user: USER as never,
      loading: false,
      needsSetup: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshMe: vi.fn(),
    } as never);
  });

  it("fires the all-time pending fetch after a status toggle, independent of the visible page", async () => {
    let pendingCalls = 0;
    let toggleCallSeen = false;

    vi.mocked(apiFetch).mockImplementation(((url: string, init?: RequestInit) => {
      if (url === "/api/v1/accounts") return Promise.resolve([]);
      if (url === "/api/v1/categories") return Promise.resolve([]);
      if (url === "/api/v1/budgets" || url.startsWith("/api/v1/budgets?"))
        return Promise.resolve([]);
      if (url === "/api/v1/settings/billing-cycle")
        return Promise.resolve({ billing_cycle_day: 1 });
      if (url === "/api/v1/settings/billing-period")
        return Promise.resolve({ id: 1, start_date: "2026-05-01", end_date: null });
      if (url === "/api/v1/settings/billing-periods")
        return Promise.resolve([{ id: 1, start_date: "2026-05-01", end_date: null }]);
      if (url.startsWith("/api/v1/forecast-plans/current")) return Promise.resolve(null);
      if (url.startsWith("/api/v1/forecast?period_start=")) return Promise.resolve(null);
      // PUT /api/v1/transactions/{id} — the status toggle write.
      if (url.startsWith("/api/v1/transactions/") && init?.method === "PUT") {
        toggleCallSeen = true;
        return Promise.resolve({});
      }
      // The fetchAll paginator hits ?status=pending&limit=200&offset=N.
      // Count those calls and return [] (empty page → fetchAll exits).
      if (url.startsWith("/api/v1/transactions?status=pending")) {
        pendingCalls += 1;
        return Promise.resolve([]);
      }
      // The non-paginated transactions calls (page list + period
      // aggregate) return [SETTLED_TX] for the "all" call so the toggle
      // button has something to click.
      if (url.startsWith("/api/v1/transactions?limit=200")) return Promise.resolve([SETTLED_TX]);
      if (url.startsWith("/api/v1/transactions?")) return Promise.resolve([SETTLED_TX]);
      return Promise.resolve({});
    }) as never);

    render(<DashboardPage />);

    // Wait for the page to settle on initial load — the toggle button
    // for our SETTLED_TX is rendered in the Recent Transactions list.
    await waitFor(
      () => expect(screen.getByLabelText(/Settled status for Coffee/)).toBeInTheDocument(),
      { timeout: 3000 },
    );

    const callsAfterMount = pendingCalls;
    expect(callsAfterMount).toBeGreaterThan(0); // initial pending load

    // Toggle the status. This used to call loadTransactions(page) only,
    // leaving pendingByAccount stale on any non-zero page. The fix
    // wires loadPendingTransactions() into the toggle handler so the
    // strip's pending totals refresh independent of the visible page.
    fireEvent.click(screen.getByLabelText(/Settled status for Coffee/));

    await waitFor(() => expect(toggleCallSeen).toBe(true));
    // Critical assertion: the pending endpoint was re-called after the
    // toggle, NOT just on the initial load.
    await waitFor(() => expect(pendingCalls).toBeGreaterThan(callsAfterMount));
  });
});
