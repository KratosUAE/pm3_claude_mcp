import type { PM3Session } from "../pm3-session.js";

export function disconnectHandler(session: PM3Session) {
  return async () => {
    try {
      await session.disconnect();
      return {
        content: [{ type: "text" as const, text: "Disconnected." }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Disconnect error: ${msg}` }],
        isError: true,
      };
    }
  };
}
