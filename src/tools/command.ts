import { z } from "zod";
import type { PM3Session } from "../pm3-session.js";

export const commandSchema = z.object({
  command: z.string().describe("Proxmark3 command to execute"),
  timeout_ms: z
    .number()
    .optional()
    .describe(
      "Max timeout in ms for long-running commands (default 120s)",
    ),
});

export function commandHandler(session: PM3Session) {
  return async (args: z.infer<typeof commandSchema>) => {
    try {
      const result = await session.sendCommand(args.command, args.timeout_ms);

      let text = result.output;
      if (result.error) {
        text += `\n\n[stderr]\n${result.error}`;
      }
      if (result.timedOut) {
        text += `\n\n[timed out after ${result.durationMs}ms]`;
      }

      return {
        content: [{ type: "text" as const, text: text || "(no output)" }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  };
}
