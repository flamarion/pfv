"use client";

/**
 * RestartTourCard — surfaces the L3.3 "Replay onboarding tour" action.
 *
 * Per-user (not org-wide), so it lives on the Profile tab rather than
 * Organization. Calls ``POST /api/v1/users/me/onboarding/restart-tour``
 * to clear ``users.onboarded_at``, then sets the same sessionStorage
 * flag the wizard's "Yes, show me" path uses so the dashboard auto-
 * starts the dot-namespaced tour on next mount.
 *
 * The endpoint is idempotent — a second click before the dashboard
 * mounts will not error, only re-stamp the audit row.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth/AuthProvider";
import { apiFetch, extractErrorMessage } from "@/lib/api";
import { btnSecondary, card, cardHeader, cardTitle } from "@/lib/styles";

// Mirrors the constant in OnboardingPageBody. Duplicated rather than
// imported so the wizard module is not pulled into the Settings page
// bundle just for one string.
const TOUR_FLAG_KEY = "tbd-pending-dashboard-tour";

export default function RestartTourCard() {
  const router = useRouter();
  const { refreshMe } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRestart() {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/api/v1/users/me/onboarding/restart-tour", {
        method: "POST",
      });
      // Refresh the cached user so any AppShell guards see the cleared
      // onboarded_at value, then stage the dashboard auto-start flag.
      await refreshMe();
      try {
        window.sessionStorage.setItem(TOUR_FLAG_KEY, "1");
      } catch {
        // Private mode or storage disabled. The dashboard tour will
        // not auto-start, but the wizard can still be re-run by
        // visiting /onboarding directly since onboarded_at is null.
      }
      router.push("/dashboard");
    } catch (err) {
      setError(extractErrorMessage(err, "Could not restart the tour. Try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={card}>
      <div className={cardHeader}>
        <h2 className={cardTitle}>Onboarding tour</h2>
      </div>
      <div className="p-6 space-y-4">
        <p className="text-sm text-text-secondary">
          Run the dashboard tour again to refresh your memory or to show
          a colleague how The Better Decision works. Replaying does not
          touch any of your data.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          onClick={handleRestart}
          disabled={submitting}
          className={btnSecondary}
          data-testid="settings-restart-tour"
        >
          {submitting ? "Starting..." : "Replay onboarding tour"}
        </button>
      </div>
    </div>
  );
}
