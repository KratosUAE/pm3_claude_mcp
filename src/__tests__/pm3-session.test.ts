import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { Writable, Readable } from "node:stream";

// Mock child_process before importing PM3Session
const mockStdin = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});
const mockStdout = new Readable({ read() {} });
const mockStderr = new Readable({ read() {} });

function createMockProcess() {
  const proc = new EventEmitter() as any;
  // Fresh streams for each process
  proc.stdin = new Writable({
    write(_chunk: any, _encoding: any, callback: any) {
      callback();
    },
  });
  proc.stdout = new Readable({ read() {} });
  proc.stderr = new Readable({ read() {} });
  proc.kill = vi.fn();
  proc.killed = false;
  proc.exitCode = null;
  proc.pid = 12345;
  return proc;
}

let currentMockProcess: any;

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    currentMockProcess = createMockProcess();
    return currentMockProcess;
  }),
}));

// Mock fs access check to always succeed
vi.mock("node:fs", () => ({
  accessSync: vi.fn(),
  constants: { X_OK: 1 },
}));

// Set env before importing config
process.env.PM3_BINARY_PATH = "/usr/bin/pm3";

import { PM3Session } from "../pm3-session.js";
import { SessionState } from "../types.js";

describe("PM3Session", () => {
  let session: PM3Session;

  beforeEach(() => {
    currentMockProcess = null;
    session = new PM3Session({
      pm3Binary: "/usr/bin/pm3",
      idleTimeoutMs: 200,
      maxTimeoutMs: 5000,
    });
  });

  afterEach(async () => {
    // Clean up any active session
    try {
      if (session.getState() === SessionState.CONNECTED) {
        // Force state to allow cleanup
        currentMockProcess?.emit("exit", 0);
      }
    } catch {
      /* ignore */
    }
  });

  describe("connect", () => {
    it("should connect with mock process and reach CONNECTED state", async () => {
      const connectPromise = session.connect();

      // Simulate pm3 banner output after short delay
      setTimeout(() => {
        currentMockProcess.stdout.push(
          Buffer.from("[=] Proxmark3 RFID instrument\n[=] Using UART port /dev/ttyACM0\n"),
        );
      }, 50);

      const banner = await connectPromise;
      expect(session.getState()).toBe(SessionState.CONNECTED);
      expect(banner).toContain("Proxmark3");
    }, 10000);

    it("should recover from ERROR state on connect", async () => {
      // First, get into ERROR state
      const connectPromise1 = session.connect();
      setTimeout(() => {
        currentMockProcess.emit("error", new Error("spawn failed"));
      }, 50);
      await expect(connectPromise1).rejects.toThrow();
      expect(session.getState()).toBe(SessionState.ERROR);

      // Now connect again — should auto-recover
      const connectPromise2 = session.connect();
      setTimeout(() => {
        currentMockProcess.stdout.push(Buffer.from("[=] Connected\n"));
      }, 50);

      const banner = await connectPromise2;
      expect(session.getState()).toBe(SessionState.CONNECTED);
      expect(banner).toContain("Connected");
    }, 10000);
  });

  describe("sendCommand", () => {
    async function connectSession() {
      const p = session.connect();
      setTimeout(() => {
        currentMockProcess.stdout.push(Buffer.from("[=] Banner\n"));
      }, 50);
      await p;
    }

    it("should return output after idle timeout", async () => {
      await connectSession();

      const cmdPromise = session.sendCommand("hw version");
      setTimeout(() => {
        currentMockProcess.stdout.push(
          Buffer.from("Proxmark3 firmware v4.0\n"),
        );
      }, 50);

      const result = await cmdPromise;
      expect(result.output).toContain("Proxmark3 firmware");
      expect(result.timedOut).toBe(false);
    }, 10000);

    it("should block concurrent commands", async () => {
      await connectSession();

      // Start first command — it won't finish immediately
      const cmd1 = session.sendCommand("hw version");
      setTimeout(() => {
        currentMockProcess.stdout.push(Buffer.from("output\n"));
      }, 50);

      // Try second command immediately
      await expect(session.sendCommand("hw status")).rejects.toThrow(
        "Another command is in progress",
      );

      await cmd1; // Let first finish
    }, 10000);

    it("should reject empty commands", async () => {
      await connectSession();
      await expect(session.sendCommand("")).rejects.toThrow("Empty command");
      await expect(session.sendCommand("  \n\r  ")).rejects.toThrow("Empty command");
    });

    it("should strip newlines from command input", async () => {
      await connectSession();

      const writeSpy = vi.spyOn(currentMockProcess.stdin, "write");
      const cmdPromise = session.sendCommand("hf mf\nautopwn");
      setTimeout(() => {
        currentMockProcess.stdout.push(Buffer.from("ok\n"));
      }, 50);

      await cmdPromise;
      // The write call should have sanitized newlines
      expect(writeSpy).toHaveBeenCalledWith("hf mfautopwn\n");
    }, 10000);
  });

  describe("disconnect", () => {
    async function connectSession() {
      const p = session.connect();
      setTimeout(() => {
        currentMockProcess.stdout.push(Buffer.from("[=] Banner\n"));
      }, 50);
      await p;
    }

    it("should send exit and clean up process", async () => {
      await connectSession();
      const proc = currentMockProcess;
      const writeSpy = vi.spyOn(proc.stdin, "write");

      const disconnectPromise = session.disconnect();
      // Simulate process exiting after exit command
      setTimeout(() => {
        proc.emit("exit", 0);
      }, 50);

      await disconnectPromise;
      expect(writeSpy).toHaveBeenCalledWith("exit\n");
    }, 10000);

    it("should handle already disconnected state", async () => {
      // Should not throw when not connected
      await session.disconnect();
      expect(session.getState()).toBe(SessionState.DISCONNECTED);
    });
  });
});
