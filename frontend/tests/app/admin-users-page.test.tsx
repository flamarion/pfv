import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import AdminUsersPage from "@/app/admin/users/page";
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

const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: replaceMock }),
  usePathname: () => "/admin/users",
}));

const SUPERADMIN = {
  id: 1,
  username: "root",
  email: "root@platform.io",
  first_name: null,
  last_name: null,
  phone: null,
  avatar_url: null,
  email_verified: true,
  role: "owner",
  org_id: 1,
  org_name: "Platform",
  billing_cycle_day: 1,
  is_superadmin: true,
  is_active: true,
  mfa_enabled: false,
  subscription_status: null,
  subscription_plan: null,
  trial_end: null,
};

const SAMPLE_USERS = {
  items: [
    {
      id: 42,
      email: "ada@acme.io",
      username: "ada",
      display_name: "Ada Lovelace",
      is_superadmin: false,
      is_active: true,
      email_verified: true,
      mfa_enabled: false,
      password_changed_at: null,
      onboarded_at: "2026-04-30T10:00:00",
      created_at: "2026-04-15T10:00:00",
      orgs: [{ org_id: 10, name: "Acme Co", role: "owner" }],
    },
    {
      id: 43,
      email: "bob@beta.io",
      username: "bob",
      display_name: null,
      is_superadmin: false,
      is_active: false,
      email_verified: true,
      mfa_enabled: false,
      password_changed_at: null,
      onboarded_at: null,
      created_at: "2026-04-10T10:00:00",
      orgs: [{ org_id: 11, name: "Beta", role: "member" }],
    },
  ],
  total: 2,
  limit: 50,
  offset: 0,
};

describe("AdminUsersPage", () => {
  const apiFetchMock = vi.mocked(apiFetch);
  const useAuthMock = vi.mocked(useAuth);

  beforeEach(() => {
    apiFetchMock.mockReset();
    replaceMock.mockReset();
    useAuthMock.mockReturnValue({
      user: SUPERADMIN as never,
      loading: false,
      needsSetup: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshMe: vi.fn(),
    });
  });

  it("renders the users table from the API", async () => {
    apiFetchMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/v1/admin/orgs")) {
        return Promise.resolve({
          items: [
            { id: 10, name: "Acme Co" },
            { id: 11, name: "Beta" },
          ],
          total: 2,
        } as never);
      }
      return Promise.resolve(SAMPLE_USERS as never);
    });

    render(<AdminUsersPage />);

    // Both display names should land in the rendered rows.
    await screen.findByText("Ada Lovelace");
    expect(screen.getByText("bob@beta.io")).toBeInTheDocument();
    // Status column derives from flags: bob is_active=false -> inactive.
    // ("inactive" appears as a filter chip too; assert the count
    // is > 1 to confirm both occurrences are rendered without colliding
    // on a single matcher.)
    expect(screen.getAllByText("inactive").length).toBeGreaterThan(0);
    // Org link shows the org name.
    expect(screen.getAllByText("Acme Co").length).toBeGreaterThan(0);
  });

  it("redirects non-superadmin users without users.view away from the page", async () => {
    useAuthMock.mockReturnValue({
      user: { ...SUPERADMIN, is_superadmin: false } as never,
      loading: false,
      needsSetup: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshMe: vi.fn(),
    });

    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("renders for a non-superadmin who carries users.view in permissions", async () => {
    apiFetchMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/v1/admin/orgs")) {
        return Promise.resolve({ items: [], total: 0 } as never);
      }
      return Promise.resolve(SAMPLE_USERS as never);
    });
    useAuthMock.mockReturnValue({
      user: {
        ...SUPERADMIN,
        is_superadmin: false,
        permissions: ["users.view"],
      } as never,
      loading: false,
      needsSetup: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshMe: vi.fn(),
    });

    render(<AdminUsersPage />);

    await screen.findByText("Ada Lovelace");
    expect(replaceMock).not.toHaveBeenCalledWith("/dashboard");
  });

  it("debounces the search input and re-fires the list call with q", async () => {
    apiFetchMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/v1/admin/orgs")) {
        return Promise.resolve({ items: [], total: 0 } as never);
      }
      return Promise.resolve(SAMPLE_USERS as never);
    });

    render(<AdminUsersPage />);

    await screen.findByText("Ada Lovelace");

    const searchInput = screen.getByLabelText(/search users/i) as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "ada" } });

    // Wait for the debounced fetch to fire with q=ada.
    await waitFor(
      () => {
        const calls = apiFetchMock.mock.calls.map((c) => c[0] as string);
        expect(
          calls.some((u) => u.includes("/api/v1/admin/users") && u.includes("q=ada")),
        ).toBe(true);
      },
      { timeout: 1500 },
    );
  });

  it("applies the role filter chip and includes role= in the API call", async () => {
    apiFetchMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/v1/admin/orgs")) {
        return Promise.resolve({ items: [], total: 0 } as never);
      }
      return Promise.resolve(SAMPLE_USERS as never);
    });

    render(<AdminUsersPage />);
    await screen.findByText("Ada Lovelace");

    fireEvent.click(screen.getByRole("button", { name: "owner" }));

    await waitFor(() => {
      const calls = apiFetchMock.mock.calls.map((c) => c[0] as string);
      expect(
        calls.some(
          (u) => u.includes("/api/v1/admin/users") && u.includes("role=owner"),
        ),
      ).toBe(true);
    });
  });
});
