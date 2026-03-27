export enum SessionState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  ERROR = "error",
}

export interface CommandResult {
  output: string;
  error: string;
  timedOut: boolean;
  durationMs: number;
}

export interface PM3Config {
  pm3Binary: string;
  port?: string;
  idleTimeoutMs: number;
  maxTimeoutMs: number;
}
