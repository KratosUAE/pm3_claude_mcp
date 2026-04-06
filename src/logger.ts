type Level = "ERROR" | "WARN" | "DEBUG";

const debugEnv = (process.env.PM3_DEBUG || "").toLowerCase();
const debugEnabled = debugEnv === "1" || debugEnv === "true" || debugEnv === "yes";

function log(level: Level, msg: string): void {
  if (level === "DEBUG" && !debugEnabled) return;
  const ts = new Date().toISOString();
  process.stderr.write(`[${ts}] [${level}] ${msg}\n`);
}

export const logger = {
  error: (msg: string) => log("ERROR", msg),
  warn: (msg: string) => log("WARN", msg),
  debug: (msg: string) => log("DEBUG", msg),
};
