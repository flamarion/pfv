import { render, screen } from "@testing-library/react";

import AppShell from "@/components/AppShell";
import { useAuth } from "@/components/auth/AuthProvider";

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/dashboard",
}));

const BASE_USER = {
  id: 1,
  username: "alice",
  email: "alice@example.com",
  first_name: "Alice",
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

describe("AppShell — system nav gating", () => {
  const useAuthMock = vi.mocked(useAuth);

  beforeEach(() => {
    useAuthMock.mockReset();
  });

  it("hides the System nav for a regular user without admin.view", () => {
    useAuthMock.mockReturnValue({
      user: BASE_USER as never,
      loading: false,
      needsSetup: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshMe: vi.fn(),
    });

    render(
      <AppShell>
        <p>page body</p>
      </AppShell>,
    );

    expect(screen.queryByText(/^System$/)).toBeNull();
    // Sidebar nav still shows Dashboard for the user.
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
  });

  it("shows the System nav for a superadmin (short-circuit)", () => {
    useAuthMock.mockReturnValue({
      user: { ...BASE_USER, is_superadmin: true } as never,
      loading: false,
      needsSetup: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshMe: vi.fn(),
    });

    render(
      <AppShell>
        <p>page body</p>
      </AppShell>,
    );

    expect(screen.getByText(/^System$/)).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Organizations")).toBeInTheDocument();
    expect(screen.getByText("Audit log")).toBeInTheDocument();
  });

  it("shows the System nav for a non-superadmin who carries admin.view in permissions", () => {
    useAuthMock.mockReturnValue({
      user: { ...BASE_USER, permissions: ["admin.view"] } as never,
      loading: false,
      needsSetup: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshMe: vi.fn(),
    });

    render(
      <AppShell>
        <p>page body</p>
      </AppShell>,
    );

    expect(screen.getByText(/^System$/)).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });
});
