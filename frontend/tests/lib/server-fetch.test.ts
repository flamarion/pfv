import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the structured logger so we can assert the exact sanitized payload
// emitted on each failure branch, without writing to stdout/stderr in tests.
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Stub server-only so the import works in a node/jsdom test env. Without
// this, `import "server-only"` throws at module load.
vi.mock("server-only", () => ({}));

async function loadModule() {
  const mod = await import("@/lib/server-fetch");
  const loggerMod = await import("@/lib/logger");
  return { serverFetch: mod.serverFetch, logger: loggerMod.logger };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("serverFetch", () => {
  it("returns null and logs sanitized warn when fetch rejects (no leaks)", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(
      new TypeError("Failed to fetch"),
    );
    const { serverFetch, logger } = await loadModule();
    const result = await serverFetch<{ ok: boolean }>("/api/v1/probe", {
      method: "GET",
      cookie: "refresh_token=SECRET-COOKIE-VALUE",
      accessToken: "SECRET-BEARER-VALUE",
    });
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      "server_fetch_failed",
      expect.objectContaining({
        method: "GET",
        path: "/api/v1/probe",
        error_name: "TypeError",
        error_message: expect.stringContaining("Failed to fetch"),
      }),
    );
    // backend_host is the host of the BACKEND URL, never user input.
    const logArgs = (logger.warn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(logArgs).toHaveProperty("backend_host");
    // Privacy invariant: no cookie, no bearer token, no header value in
    // the logged payload.
    const serialized = JSON.stringify(logArgs);
    expect(serialized).not.toContain("SECRET-COOKIE-VALUE");
    expect(serialized).not.toContain("SECRET-BEARER-VALUE");
    expect(serialized).not.toContain("Bearer ");
  });

  it("returns null and logs sanitized warn when res.json() throws on invalid JSON", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    } as unknown as Response);
    const { serverFetch, logger } = await loadModule();
    const result = await serverFetch<{ ok: boolean }>("/api/v1/probe", {
      accessToken: "SECRET-BEARER-VALUE",
    });
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      "server_fetch_failed",
      expect.objectContaining({
        path: "/api/v1/probe",
        error_name: "SyntaxError",
      }),
    );
    const logArgs = (logger.warn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(JSON.stringify(logArgs)).not.toContain("SECRET-BEARER-VALUE");
  });

  it("returns null and emits server_fetch_non_ok warn on a non-OK response by default", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ detail: "Service Unavailable" }),
    } as unknown as Response);
    const { serverFetch, logger } = await loadModule();
    const result = await serverFetch<{ ok: boolean }>("/api/v1/probe", {
      method: "POST",
      accessToken: "SECRET-BEARER-VALUE",
    });
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      "server_fetch_non_ok",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/probe",
        status: 503,
      }),
    );
    const logArgs = (logger.warn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(JSON.stringify(logArgs)).not.toContain("SECRET-BEARER-VALUE");
  });

  it("returns null and does NOT warn on non-OK when silentNonOk is true", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: "Unauthorized" }),
    } as unknown as Response);
    const { serverFetch, logger } = await loadModule();
    const result = await serverFetch<{ ok: boolean }>("/api/v1/auth/verify", {
      method: "POST",
      cookie: "refresh_token=x",
      silentNonOk: true,
    });
    expect(result).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("returns parsed JSON and does not warn on a 200 response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ value: 42 }),
    } as unknown as Response);
    const { serverFetch, logger } = await loadModule();
    const result = await serverFetch<{ value: number }>("/api/v1/probe", {
      accessToken: "SECRET-BEARER-VALUE",
    });
    expect(result).toEqual({ value: 42 });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
