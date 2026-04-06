import { spawn, type ChildProcess } from "node:child_process";
import { dirname } from "node:path";
import { SessionState, type CommandResult, type PM3Config } from "./types.js";
import { resolveConfig } from "./config.js";
import { stripAnsi } from "./pm3-output-parser.js";
import { logger } from "./logger.js";

const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB

export class PM3Session {
  private process: ChildProcess | null = null;
  private state: SessionState = SessionState.DISCONNECTED;
  private config: PM3Config;
  private commandInFlight = false;
  private deviceInfo = "";
  private operationLock: Promise<unknown> | null = null;

  constructor(config?: Partial<PM3Config>) {
    const defaults = resolveConfig();
    this.config = { ...defaults, ...config };
  }

  getState(): SessionState {
    return this.state;
  }

  getDeviceInfo(): string {
    return this.deviceInfo;
  }

  async connect(port?: string): Promise<string> {
    // 2.4: Operation mutex — prevent concurrent connect/disconnect
    while (this.operationLock) await this.operationLock;
    let resolve: () => void;
    this.operationLock = new Promise<void>(r => { resolve = r; });
    try {
      return await this._doConnect(port);
    } finally {
      this.operationLock = null;
      resolve!();
    }
  }

  private async _doConnect(port?: string): Promise<string> {
    // 1.3: Error recovery — auto-cleanup and reconnect from ERROR state
    if (this.state === SessionState.ERROR) {
      logger.warn("Recovering from error state, reconnecting...");
      this.cleanup();
      // 2.4: Verify old process is fully dead before proceeding
      await this.ensureProcessDead();
      this.state = SessionState.DISCONNECTED;
    }

    if (this.state === SessionState.CONNECTED) {
      throw new Error("Already connected. Disconnect first.");
    }

    this.state = SessionState.CONNECTING;
    logger.debug(`Connecting to pm3 (binary: ${this.config.pm3Binary}, port: ${port ?? "auto"})`);

    const args: string[] = [];
    if (port) {
      args.push(port);
    }
    // -i flag keeps pm3 in command loop even when stdin is a pipe
    args.push("-i");

    return new Promise<string>((resolve, reject) => {
      const proc = spawn(this.config.pm3Binary, args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: dirname(this.config.pm3Binary),
        env: { ...process.env, TERM: "dumb" },
      });

      this.process = proc;
      let banner = "";
      let settled = false;

      const onData = (chunk: Buffer) => {
        banner += stripAnsi(chunk.toString());
      };

      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", onData);

      // Wait for banner to settle, then drain for 500ms to prevent tail leaking into first command
      const bannerTimeout = setTimeout(() => {
        if (!settled) {
          // 2.2: Drain phase — keep collecting for 500ms more, then discard drained output
          const bannerSnapshot = banner;
          setTimeout(() => {
            if (!settled) {
              settled = true;
              proc.stdout?.removeListener("data", onData);
              proc.stderr?.removeListener("data", onData);
              // Use snapshot from before drain — drained output is discarded
              this.deviceInfo = bannerSnapshot.trim();
              this.state = SessionState.CONNECTED;
              logger.debug("Connected to pm3, state → CONNECTED");
              this.attachProcessHandlers();
              resolve(this.deviceInfo);
            }
          }, 500);
        }
      }, 3000);

      proc.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(bannerTimeout);
          this.state = SessionState.ERROR;
          logger.error(`Failed to start pm3: ${err.message}`);
          reject(new Error(`Failed to start pm3: ${err.message}`));
        }
      });

      proc.on("exit", (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(bannerTimeout);
          this.state = SessionState.ERROR;
          const msg = banner.trim() || `pm3 exited with code ${code}`;
          logger.error(`pm3 process exited during connect: ${msg}`);
          reject(new Error(msg));
        }
      });
    });
  }

  async sendCommand(
    command: string,
    timeoutMs?: number,
  ): Promise<CommandResult> {
    if (this.state !== SessionState.CONNECTED || !this.process) {
      throw new Error("Not connected. Call connect() first.");
    }
    if (this.commandInFlight) {
      throw new Error(
        "Another command is in progress. Wait for it to complete.",
      );
    }

    // 3.4: Input validation — sanitize command
    const sanitized = command.replace(/[\r\n]/g, "").trim();
    if (sanitized.length === 0) {
      throw new Error("Empty command. Provide a valid pm3 command.");
    }

    this.commandInFlight = true;
    logger.debug(`Sending command: ${sanitized}`);
    const idleTimeout = this.config.idleTimeoutMs;
    const maxTimeout = timeoutMs ?? this.config.maxTimeoutMs;
    const startTime = Date.now();

    return new Promise<CommandResult>((resolve) => {
      let output = "";
      let error = "";
      let timedOut = false;
      let finished = false;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let maxTimer: ReturnType<typeof setTimeout> | null = null;

      let outputTruncated = false;

      const finish = () => {
        if (finished) return;
        finished = true;
        if (idleTimer) clearTimeout(idleTimer);
        if (maxTimer) clearTimeout(maxTimer);
        this.process?.stdout?.removeListener("data", onStdout);
        this.process?.stderr?.removeListener("data", onStderr);
        // 1.4: Remove stdin error listener after command completes
        this.process?.stdin?.removeListener("error", onStdinError);
        this.commandInFlight = false;
        resolve({
          output: output.trim(),
          error: error.trim(),
          timedOut,
          durationMs: Date.now() - startTime,
        });
      };

      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          // 2.1: Device disconnect detection — if command was non-empty and output is empty,
          // run a health check before finishing
          if (sanitized.length > 0 && output.trim().length === 0 && !outputTruncated) {
            this.healthCheck().then((alive) => {
              if (!alive && !finished) {
                this.state = SessionState.ERROR;
                error += "\n[Device may be disconnected — no response to health check]";
              }
              finish();
            });
          } else {
            finish();
          }
        }, idleTimeout);
      };

      const onStdout = (chunk: Buffer) => {
        // 2.3: Large output protection
        if (outputTruncated) return;
        const text = stripAnsi(chunk.toString());
        if (output.length + text.length > MAX_OUTPUT_SIZE) {
          output += text.slice(0, MAX_OUTPUT_SIZE - output.length);
          output += "\n[output truncated, exceeded 10MB limit]";
          outputTruncated = true;
          finish();
          return;
        }
        output += text;
        resetIdleTimer();
      };

      const onStderr = (chunk: Buffer) => {
        // 2.3: Large output protection (count stderr toward limit too)
        if (outputTruncated) return;
        const text = stripAnsi(chunk.toString());
        if (error.length + text.length > MAX_OUTPUT_SIZE) {
          error += text.slice(0, MAX_OUTPUT_SIZE - error.length);
          error += "\n[output truncated, exceeded 10MB limit]";
          outputTruncated = true;
          finish();
          return;
        }
        error += text;
        resetIdleTimer();
      };

      // 1.4: stdin error handler — reject immediately on write pipe failure
      const onStdinError = (err: Error) => {
        if (!finished) {
          this.state = SessionState.ERROR;
          error += `\n[stdin write error: ${err.message}]`;
          finish();
        }
      };

      this.process!.stdout?.on("data", onStdout);
      this.process!.stderr?.on("data", onStderr);

      // Max timeout safety net
      maxTimer = setTimeout(() => {
        timedOut = true;
        finish();
      }, maxTimeout);

      // 1.4: Check if stdin is destroyed before writing
      if (this.process!.stdin?.destroyed) {
        this.state = SessionState.ERROR;
        error = "[stdin pipe is destroyed, cannot send command]";
        finish();
        return;
      }

      // 1.4: Listen for stdin errors before writing
      this.process!.stdin?.once("error", onStdinError);

      // Send command (use sanitized version)
      this.process!.stdin?.write(sanitized + "\n");

      // Start idle timer
      resetIdleTimer();
    });
  }

  async disconnect(): Promise<void> {
    // 2.4: Operation mutex — prevent concurrent connect/disconnect
    while (this.operationLock) await this.operationLock;
    let resolve: () => void;
    this.operationLock = new Promise<void>(r => { resolve = r; });
    try {
      return await this._doDisconnect();
    } finally {
      this.operationLock = null;
      resolve!();
    }
  }

  private async _doDisconnect(): Promise<void> {
    if (!this.process) {
      this.state = SessionState.DISCONNECTED;
      return;
    }
    logger.debug("Disconnecting from pm3...");

    return new Promise<void>((resolve) => {
      const proc = this.process!;
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        this.cleanup();
        resolve();
      };

      const killTimer = setTimeout(() => {
        proc.kill("SIGKILL");
        // 2.4: Wait for exit event after SIGKILL with a safety timeout
        const sigkillExitTimer = setTimeout(() => {
          // Process didn't exit even after SIGKILL — check and log
          if (!proc.killed && proc.exitCode === null) {
            logger.error("Process did not exit after SIGKILL");
          }
          finish();
        }, 1000);
        proc.once("exit", () => {
          clearTimeout(sigkillExitTimer);
          finish();
        });
      }, 2000);

      proc.once("exit", () => {
        clearTimeout(killTimer);
        finish();
      });

      proc.stdin?.write("exit\n");
    });
  }

  private attachProcessHandlers(): void {
    if (!this.process) return;

    this.process.on("exit", (code) => {
      if (this.state === SessionState.CONNECTED) {
        logger.debug(`pm3 process exited (code ${code}), state → DISCONNECTED`);
        this.state = SessionState.DISCONNECTED;
      }
      this.cleanup();
    });

    this.process.on("error", (err) => {
      logger.error(`pm3 process error: ${err.message}, state → ERROR`);
      this.state = SessionState.ERROR;
      this.cleanup();
    });
  }

  // 2.1: Health check — sends `hw status` and checks for response
  private async healthCheck(): Promise<boolean> {
    if (!this.process || this.process.stdin?.destroyed) return false;

    // Clean up any stale command state before attaching health check listeners
    this.commandInFlight = false;
    this.process.stdout?.removeAllListeners("data");
    this.process.stderr?.removeAllListeners("data");

    return new Promise<boolean>((resolve) => {
      let response = "";
      let settled = false;
      const healthTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.process?.stdout?.removeListener("data", onData);
        resolve(response.trim().length > 0);
      }, 5000);

      const onData = (chunk: Buffer) => {
        if (settled) return;
        response += stripAnsi(chunk.toString());
        // Got some output — device is alive
        settled = true;
        clearTimeout(healthTimeout);
        this.process?.stdout?.removeListener("data", onData);
        resolve(true);
      };

      this.process!.stdout?.on("data", onData);
      this.process!.stdin?.write("hw status\n");
    });
  }

  // 2.4: Verify old process is fully dead before spawning a new one
  private async ensureProcessDead(): Promise<void> {
    if (!this.process) return;
    const proc = this.process;
    if (proc.exitCode !== null || proc.killed) {
      this.process = null;
      return;
    }
    // Process is still alive — force kill and wait
    proc.kill("SIGKILL");
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        resolve();
      }, 1000);
      proc.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    this.process = null;
  }

  private cleanup(): void {
    if (this.process) {
      try {
        this.process.kill();
      } catch {
        /* already dead */
      }
    }
    this.process = null;
    this.commandInFlight = false;
  }
}
