import type { PM3Config } from "./types.js";

export const DEFAULT_CONFIG: PM3Config = {
  pm3Binary: "/home/kratos/proxmark3/pm3",
  idleTimeoutMs: 3000,
  maxTimeoutMs: 120_000,
};
