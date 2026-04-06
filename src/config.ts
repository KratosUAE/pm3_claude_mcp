import { execSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import type { PM3Config } from "./types.js";

function findBinary(): string {
  for (const name of ["pm3", "proxmark3"]) {
    try {
      return execSync(`which ${name}`, { encoding: "utf-8" }).trim();
    } catch {
      /* continue */
    }
  }
  return "/usr/local/bin/pm3";
}

function validateBinary(path: string): void {
  try {
    accessSync(path, constants.X_OK);
  } catch {
    throw new Error(
      `pm3 binary not found or not executable at "${path}". Set PM3_BINARY_PATH env variable.`,
    );
  }
}

export function resolveConfig(): PM3Config {
  const pm3Binary = process.env.PM3_BINARY_PATH || findBinary();
  validateBinary(pm3Binary);

  const parsedIdle = parseInt(process.env.PM3_IDLE_TIMEOUT ?? "", 10);
  const idleTimeoutMs = Number.isFinite(parsedIdle) && parsedIdle > 0 ? parsedIdle : 3000;

  const parsedMax = parseInt(process.env.PM3_MAX_TIMEOUT ?? "", 10);
  const maxTimeoutMs = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 120_000;

  return {
    pm3Binary,
    idleTimeoutMs,
    maxTimeoutMs,
  };
}

