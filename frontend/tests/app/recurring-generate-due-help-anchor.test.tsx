import { render, screen, waitFor } from "@testing-library/react";

import RecurringPage from "@/app/recurring/page";
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
  usePathname: () => "/recurring",
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
  password_set: true,
  subscription_status: null,
  subscription_plan: null,
  trial_end: null,
  allow_manual_balance_adjustment: false,
};

function mockApi() {
  vi.mocked(apiFetch).mockImplementation(((url: string) => {
    if (url === "/api/v1/recurring") return Promise.resolve([]);
    return Promise.resolve({});
  }) as never);
}

describe("RecurringPage — Generate Due HelpAnchor", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(useAuth).mockReturnValue({
      user: USER as never,
      loading: false,
      needsSetup: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshMe: vi.fn(),
    } as never);
    mockApi();
  });

  it("renders a HelpAnchor next to the Generate Due button pointing at /docs#recurring", async () => {
    render(<RecurringPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Generate Due/ }),
      ).toBeInTheDocument(),
    );

    // aria-label includes "Help: Generate due" so screen-reader users
    // pick up the affordance association before the icon.
    const helpLink = screen.getByRole("link", { name: /Help: Generate due/ });
    expect(helpLink).toHaveAttribute("href", "/docs#recurring");
    expect(helpLink).toHaveAttribute("target", "_blank");
    expect(helpLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(helpLink).toHaveAttribute("data-section", "recurring");
  });

  it("uses the inline-title HelpAnchor variant (next to the page-title button cluster)", async () => {
    render(<RecurringPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Generate Due/ }),
      ).toBeInTheDocument(),
    );

    const helpLink = screen.getByTestId("help-anchor");
    // inline-title sits next to a page-title-level affordance and
    // self-aligns to cap height of adjacent text. card-corner would
    // absolutely position, which is wrong here — the surrounding flex
    // row is not a relative card.
    expect(helpLink).toHaveAttribute("data-variant", "inline-title");
  });

  it("keeps the Generate Due button clickable next to the help icon", async () => {
    render(<RecurringPage />);
    const button = await screen.findByRole("button", { name: /Generate Due/ });

    // The HelpAnchor is a sibling of the button inside the title-row
    // flex cluster, not a wrapper, so the button stays a button.
    expect(button.tagName).toBe("BUTTON");
    expect(button).not.toBeDisabled();
  });
});
