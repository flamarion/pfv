// Keep-warm heartbeat for the backend container.
//
// PR fix(frontend) cold-start: the user's DO App Platform Basic-XS tier
// hibernates the backend container during idle. A 4-minute heartbeat from
// the browser while the tab is visible AND the user is signed in keeps the
// container warm, eliminating the cold-start latency that was tripping the
// 10s apiFetch timeout and surfacing "Session refresh temporarily
// unavailable" to the user.
//
// Contract:
//   * Ping ``/health?keep-warm=1`` every 4 minutes while
//     ``document.visibilityState !== "hidden"``. The backend exposes
//     ``/health`` (not ``/api/v1/health``) and the existing nginx
//     ``location = /health`` block + App Platform ingress route it
//     straight to the backend. The ``?keep-warm=1`` query param lets
//     backend access logs distinguish heartbeats from real liveness
//     checks if needed (note: ``/health`` is already in the
//     ``_SILENT_PATHS`` access-log filter, so this is informational only
//     for any future tooling that bypasses that filter).
//   * Pause the timer on ``visibilitychange`` -> hidden, resume on
//     ``visibilitychange`` -> visible. Pinging while hidden is wasted
//     work; the browser may also throttle background timers.
//   * Stop entirely on ``auth:unauthenticated`` (the same window event
//     apiFetch dispatches on terminal /refresh failure). The caller is
//     also expected to call the returned cleanup fn on sign-out via
//     ``useEffect``.
//   * Best-effort. No error surfacing, no retry, no telemetry. If the
//     fetch 5xx's or aborts the next tick simply tries again.

const KEEP_WARM_INTERVAL_MS = 4 * 60 * 1000;
const KEEP_WARM_PATH = "/health?keep-warm=1";

export function startKeepWarm(): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const ping = () => {
    // Guard against pinging when the tab is backgrounded. The
    // visibilitychange listener also pauses the timer, but a race
    // between the listener firing and the next interval tick could
    // otherwise sneak through.
    if (typeof document !== "undefined" && document.hidden) return;
    // credentials: "omit" so the heartbeat never carries cookies; this
    // is purely a wake-up probe and must not interact with session
    // refresh, rate limits, or audit logging. Errors are swallowed --
    // a missed tick will be re-tried on the next interval.
    fetch(KEEP_WARM_PATH, { method: "GET", credentials: "omit" }).catch(() => {});
  };

  const start = () => {
    if (timer !== null) return;
    // Immediate ping on (re)start so a freshly visible tab warms the
    // container right away instead of waiting up to 4 minutes for the
    // first interval tick.
    ping();
    timer = setInterval(ping, KEEP_WARM_INTERVAL_MS);
  };

  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const onVisibilityChange = () => {
    if (typeof document === "undefined") return;
    if (document.hidden) stop();
    else start();
  };

  const onUnauthenticated = () => {
    // Once the user is signed out the heartbeat must stop entirely;
    // the next sign-in will mount a fresh keep-warm.
    stop();
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("auth:unauthenticated", onUnauthenticated);
  }

  start();

  return () => {
    stop();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("auth:unauthenticated", onUnauthenticated);
    }
  };
}
