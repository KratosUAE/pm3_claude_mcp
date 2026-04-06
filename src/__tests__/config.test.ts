import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs to avoid actual file system checks
vi.mock("node:fs", () => ({
  accessSync: vi.fn(),
  constants: { X_OK: 1 },
}));

// Mock child_process for binary discovery
vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => {
    throw new Error("not found");
  }),
}));

describe("resolveConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset modules to re-evaluate env vars
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should use PM3_BINARY_PATH from env", async () => {
    process.env.PM3_BINARY_PATH = "/custom/path/pm3";
    const { resolveConfig } = await import("../config.js");
    const config = resolveConfig();
    expect(config.pm3Binary).toBe("/custom/path/pm3");
  });

  it("should parse PM3_IDLE_TIMEOUT from env", async () => {
    process.env.PM3_BINARY_PATH = "/usr/bin/pm3";
    process.env.PM3_IDLE_TIMEOUT = "5000";
    const { resolveConfig } = await import("../config.js");
    const config = resolveConfig();
    expect(config.idleTimeoutMs).toBe(5000);
  });

  it("should use default timeout for invalid PM3_IDLE_TIMEOUT", async () => {
    process.env.PM3_BINARY_PATH = "/usr/bin/pm3";
    process.env.PM3_IDLE_TIMEOUT = "abc";
    const { resolveConfig } = await import("../config.js");
    const config = resolveConfig();
    // parseInt("abc") returns NaN, which fails the Number.isFinite check, so default 3000 is used
    expect(config.idleTimeoutMs).toBe(3000);
  });

  it("should use default maxTimeout when not set", async () => {
    process.env.PM3_BINARY_PATH = "/usr/bin/pm3";
    delete process.env.PM3_MAX_TIMEOUT;
    const { resolveConfig } = await import("../config.js");
    const config = resolveConfig();
    expect(config.maxTimeoutMs).toBe(120_000);
  });

  it("should fallback to /usr/local/bin/pm3 when no binary found", async () => {
    delete process.env.PM3_BINARY_PATH;
    const { resolveConfig } = await import("../config.js");
    const config = resolveConfig();
    expect(config.pm3Binary).toBe("/usr/local/bin/pm3");
  });
});
