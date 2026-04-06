import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("logger", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let writeSpy: any;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as any);
    vi.resetModules();
  });

  afterEach(() => {
    writeSpy.mockRestore();
    process.env = { ...originalEnv };
  });

  it("should always emit ERROR messages", async () => {
    delete process.env.PM3_DEBUG;
    const { logger } = await import("../logger.js");
    logger.error("test error");
    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain("[ERROR]");
    expect(output).toContain("test error");
  });

  it("should always emit WARN messages", async () => {
    delete process.env.PM3_DEBUG;
    const { logger } = await import("../logger.js");
    logger.warn("test warn");
    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain("[WARN]");
  });

  it("should suppress DEBUG when PM3_DEBUG is not set", async () => {
    delete process.env.PM3_DEBUG;
    const { logger } = await import("../logger.js");
    logger.debug("hidden");
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("should emit DEBUG when PM3_DEBUG=1", async () => {
    process.env.PM3_DEBUG = "1";
    const { logger } = await import("../logger.js");
    logger.debug("visible");
    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain("[DEBUG]");
    expect(output).toContain("visible");
  });

  it("should include ISO timestamp in output", async () => {
    const { logger } = await import("../logger.js");
    logger.error("ts test");
    const output = writeSpy.mock.calls[0][0] as string;
    // ISO format: 2026-04-06T12:00:00.000Z
    expect(output).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
