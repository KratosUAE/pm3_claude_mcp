import { spawn, type ChildProcess } from "node:child_process";
import { dirname } from "node:path";
import { SessionState, type CommandResult, type PM3Config } from "./types.js";
import { DEFAULT_CONFIG } from "./config.js";
import { stripAnsi } from "./pm3-output-parser.js";

export class PM3Session {
  private process: ChildProcess | null = null;
  private state: SessionState = SessionState.DISCONNECTED;
  private config: PM3Config;
  private commandInFlight = false;
  private deviceInfo = "";

  constructor(config?: Partial<PM3Config>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getState(): SessionState {
    return this.state;
  }

  getDeviceInfo(): string {
    return this.deviceInfo;
  }

  async connect(port?: string): Promise<string> {
    if (this.state === SessionState.CONNECTED) {
      throw new Error("Already connected. Disconnect first.");
    }

    this.state = SessionState.CONNECTING;

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

      // Wait for banner to settle
      const bannerTimeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.stdout?.removeListener("data", onData);
          proc.stderr?.removeListener("data", onData);
          this.deviceInfo = banner.trim();
          this.state = SessionState.CONNECTED;
          this.attachProcessHandlers();
          resolve(this.deviceInfo);
        }
      }, 3000);

      proc.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(bannerTimeout);
          this.state = SessionState.ERROR;
          reject(new Error(`Failed to start pm3: ${err.message}`));
        }
      });

      proc.on("exit", (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(bannerTimeout);
          this.state = SessionState.ERROR;
          const msg = banner.trim() || `pm3 exited with code ${code}`;
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

    this.commandInFlight = true;
    const idleTimeout = this.config.idleTimeoutMs;
    const maxTimeout = timeoutMs ?? this.config.maxTimeoutMs;
    const startTime = Date.now();

    return new Promise<CommandResult>((resolve) => {
      let output = "";
      let error = "";
      let timedOut = false;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let maxTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = () => {
        if (idleTimer) clearTimeout(idleTimer);
        if (maxTimer) clearTimeout(maxTimer);
        this.process?.stdout?.removeListener("data", onStdout);
        this.process?.stderr?.removeListener("data", onStderr);
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
        idleTimer = setTimeout(finish, idleTimeout);
      };

      const onStdout = (chunk: Buffer) => {
        output += stripAnsi(chunk.toString());
        resetIdleTimer();
      };

      const onStderr = (chunk: Buffer) => {
        error += stripAnsi(chunk.toString());
        resetIdleTimer();
      };

      this.process!.stdout?.on("data", onStdout);
      this.process!.stderr?.on("data", onStderr);

      // Max timeout safety net
      maxTimer = setTimeout(() => {
        timedOut = true;
        finish();
      }, maxTimeout);

      // Send command
      this.process!.stdin?.write(command + "\n");

      // Start idle timer
      resetIdleTimer();
    });
  }

  async disconnect(): Promise<void> {
    if (!this.process) {
      this.state = SessionState.DISCONNECTED;
      return;
    }

    return new Promise<void>((resolve) => {
      const proc = this.process!;
      const killTimer = setTimeout(() => {
        proc.kill("SIGKILL");
      }, 2000);

      proc.on("exit", () => {
        clearTimeout(killTimer);
        this.cleanup();
        resolve();
      });

      proc.stdin?.write("exit\n");
    });
  }

  private attachProcessHandlers(): void {
    if (!this.process) return;

    this.process.on("exit", () => {
      if (this.state === SessionState.CONNECTED) {
        this.state = SessionState.DISCONNECTED;
      }
      this.cleanup();
    });

    this.process.on("error", () => {
      this.state = SessionState.ERROR;
      this.cleanup();
    });
  }

  private cleanup(): void {
    this.process = null;
    this.commandInFlight = false;
  }
}
