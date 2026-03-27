import type { PM3Session } from "../pm3-session.js";

export function statusHandler(session: PM3Session) {
  return async () => {
    const state = session.getState();
    const info = session.getDeviceInfo();

    let text = `State: ${state}`;
    if (info) {
      text += `\n\n${info}`;
    }

    return {
      content: [{ type: "text" as const, text }],
    };
  };
}
