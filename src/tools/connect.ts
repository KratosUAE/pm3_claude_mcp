import { z } from "zod";
import type { PM3Session } from "../pm3-session.js";

export const connectSchema = z.object({
  port: z
    .string()
    .optional()
    .describe(
      "Serial port (e.g. /dev/ttyACM0). Auto-detect if omitted.",
    ),
});

export function connectHandler(session: PM3Session) {
  return async (args: z.infer<typeof connectSchema>) => {
    try {
      const banner = await session.connect(args.port);
      return {
        content: [{ type: "text" as const, text: `Connected.\n\n${banner}` }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Connection failed: ${msg}` }],
        isError: true,
      };
    }
  };
}
