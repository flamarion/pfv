"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import HelpAnchor from "@/components/HelpAnchor";
import Spinner from "@/components/ui/Spinner";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiFetch, extractErrorMessage } from "@/lib/api";
import { hasPlatformPermission } from "@/lib/auth";
import {
  card,
  cardHeader,
  cardTitle,
  error as errorCls,
  input,
  pageTitle,
} from "@/lib/styles";

// L4.4 cross-org user search list. Mirrors /admin/orgs/page.tsx in
// shape: header + search input + filter chips + paginated table.
// Filter behavior:
// - search bar debounces 300ms.
// - role / status chips are radio-like (one active at a time).
// - "Org" filter is a dropdown sourced from /admin/orgs (cap 200).
// The query string is the source of truth for the filter state when
// the user navigates away and back; offset resets when filters change.

type OrgRef = {
  org_id: number;
  name: string;
  role: string;
};

type UserRow = {
  id: number;
  email: string;
  username: string;
  display_name: string | null;
  is_superadmin: boolean;
  is_active: boolean;
  email_verified: boolean;
  mfa_enabled: boolean;
  password_changed_at: string | null;
  onboarded_at: string | null;
  created_at: string | null;
  orgs: OrgRef[];
};

type UsersListResponse = {
  items: UserRow[];
  total: number;
  limit: number;
  offset: number;
};

type OrgPickerOption = {
  id: number;
  name: string;
};

type OrgsListResponse = {
  items: { id: number; name: string }[];
  total: number;
};

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;
const ROLE_OPTIONS = ["owner", "admin", "member"] as const;
const STATUS_OPTIONS = ["active", "inactive", "unverified", "superadmin"] as const;

function chipClass(active: boolean): string {
  return [
    "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors",
    active
      ? "border-accent bg-accent/10 text-accent"
      : "border-border bg-bg-elevated text-text-secondary hover:border-border-strong hover:text-text",
  ].join(" ");
}

export default function AdminUsersPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Filter state.
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [orgId, setOrgId] = useState<number | "">("");
  const [role, setRole] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [offset, setOffset] = useState(0);

  const [data, setData] = useState<UsersListResponse | null>(null);
  const [orgOptions, setOrgOptions] = useState<OrgPickerOption[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  // Permission gate.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!hasPlatformPermission(user, "users.view")) {
      router.replace("/dashboard");
    }
  }, [loading, user, router]);

  // Load the org picker once. Capped at 200 rows because that is the
  // backend's cap; the picker is a dropdown not an infinite list.
  useEffect(() => {
    if (loading || !user || !hasPlatformPermission(user, "users.view")) return;
    apiFetch<OrgsListResponse>("/api/v1/admin/orgs?limit=200")
      .then((d) => setOrgOptions(d.items.map((o) => ({ id: o.id, name: o.name }))))
      .catch(() => {
        // Silent: a missing picker degrades the filter UX but doesn't
        // block the list itself. The list page still works.
      });
  }, [loading, user]);

  // Debounce the search input. Resets offset to 0 whenever q changes.
  useEffect(() => {
    const handle = setTimeout(() => {
      setQ(qInput.trim());
      setOffset(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [qInput]);

  // Fetch the list. Re-runs whenever any filter changes.
  useEffect(() => {
    if (loading || !user || !hasPlatformPermission(user, "users.view")) return;
    setFetching(true);
    setError("");
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (q) params.set("q", q);
    if (orgId !== "") params.set("org_id", String(orgId));
    if (role) params.set("role", role);
    if (status) params.set("status", status);
    apiFetch<UsersListResponse>(`/api/v1/admin/users?${params.toString()}`)
      .then((d) => setData(d))
      .catch((err) => setError(extractErrorMessage(err, "Failed to load")))
      .finally(() => setFetching(false));
  }, [loading, user, q, orgId, role, status, offset]);

  const filtersActive = useMemo(
    () => Boolean(q || orgId !== "" || role || status),
    [q, orgId, role, status],
  );

  function resetFilters() {
    setQInput("");
    setQ("");
    setOrgId("");
    setRole("");
    setStatus("");
    setOffset(0);
  }

  if (loading || !user || !hasPlatformPermission(user, "users.view")) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <AppShell>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="flex items-start gap-2">
          <h1 className={`${pageTitle} mb-0`}>Users</h1>
          <HelpAnchor section="admin-users" label="Users admin" variant="inline-title" />
        </div>
      </div>

      {error && (
        <div className={`${errorCls} mb-4`} role="alert">
          {error}
        </div>
      )}

      <div className={`${card} mb-6`}>
        <div className={cardHeader}>
          <h2 className={cardTitle}>All users</h2>
        </div>

        {/* Search row */}
        <div className="px-6 py-4">
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search by email, username, or name"
            className={`${input} w-full max-w-sm`}
            aria-label="Search users"
          />
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap items-center gap-2 px-6 pb-4">
          <span className="text-xs uppercase tracking-wider text-text-muted">Org</span>
          <select
            value={orgId === "" ? "" : String(orgId)}
            onChange={(e) => {
              const val = e.target.value;
              setOrgId(val === "" ? "" : Number(val));
              setOffset(0);
            }}
            aria-label="Filter by organization"
            className={`${input} max-w-[14rem]`}
          >
            <option value="">All</option>
            {orgOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>

          <span className="ml-2 text-xs uppercase tracking-wider text-text-muted">Role</span>
          <button
            type="button"
            className={chipClass(role === "")}
            onClick={() => {
              setRole("");
              setOffset(0);
            }}
          >
            All
          </button>
          {ROLE_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              className={chipClass(role === r)}
              onClick={() => {
                setRole(role === r ? "" : r);
                setOffset(0);
              }}
            >
              {r}
            </button>
          ))}

          <span className="ml-2 text-xs uppercase tracking-wider text-text-muted">Status</span>
          <button
            type="button"
            className={chipClass(status === "")}
            onClick={() => {
              setStatus("");
              setOffset(0);
            }}
          >
            All
          </button>
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className={chipClass(status === s)}
              onClick={() => {
                setStatus(status === s ? "" : s);
                setOffset(0);
              }}
            >
              {s}
            </button>
          ))}

          {filtersActive && (
            <button
              type="button"
              onClick={resetFilters}
              className="ml-auto text-xs text-text-muted underline hover:text-text"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-border text-left text-xs uppercase tracking-wider text-text-muted">
                <th className="px-6 py-3">Name / email</th>
                <th className="px-6 py-3">Username</th>
                <th className="px-6 py-3">Org</th>
                <th className="px-6 py-3">Role</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {fetching && (
                <tr>
                  <td colSpan={6} className="px-6 py-6 text-center text-text-muted">
                    Loading
                  </td>
                </tr>
              )}
              {!fetching && data?.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-6 text-center text-text-muted">
                    No users match the current filters.
                  </td>
                </tr>
              )}
              {!fetching &&
                data?.items.map((row) => {
                  const primaryOrg = row.orgs[0];
                  const statusLabel = row.is_superadmin
                    ? "superadmin"
                    : !row.is_active
                      ? "inactive"
                      : !row.email_verified
                        ? "unverified"
                        : "active";
                  return (
                    <tr key={row.id} className="border-b border-border-subtle">
                      <td className="px-6 py-3">
                        <Link
                          href={`/admin/users/${row.id}`}
                          className="text-accent hover:text-accent-hover"
                        >
                          {row.display_name || row.email}
                        </Link>
                        {row.display_name && (
                          <div className="text-xs text-text-muted">{row.email}</div>
                        )}
                      </td>
                      <td className="px-6 py-3 text-text-secondary">{row.username}</td>
                      <td className="px-6 py-3 text-text-secondary">
                        {primaryOrg ? (
                          <Link
                            href={`/admin/orgs/${primaryOrg.org_id}`}
                            className="hover:text-accent"
                          >
                            {primaryOrg.name}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-6 py-3 text-text-secondary">
                        {primaryOrg?.role ?? "—"}
                      </td>
                      <td className="px-6 py-3 text-text-secondary">{statusLabel}</td>
                      <td className="px-6 py-3 text-text-secondary tabular-nums">
                        {row.created_at?.slice(0, 10) ?? "—"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-6 py-3 text-xs text-text-muted">
            <span>
              {offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} of {data.total}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="rounded-md border border-border px-3 py-1 disabled:opacity-50"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={offset + PAGE_SIZE >= data.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="rounded-md border border-border px-3 py-1 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
