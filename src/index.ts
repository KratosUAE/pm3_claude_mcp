import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PM3Session } from "./pm3-session.js";
import { connectSchema, connectHandler } from "./tools/connect.js";
import { commandSchema, commandHandler } from "./tools/command.js";
import { statusHandler } from "./tools/status.js";
import { disconnectHandler } from "./tools/disconnect.js";

const session = new PM3Session();

const server = new McpServer({
  name: "proxmark3",
  version: "1.0.0",
});

server.tool(
  "pm3_connect",
  "Connect to Proxmark3 device. Auto-detects port if not specified.",
  connectSchema.shape,
  connectHandler(session),
);

server.tool(
  "pm3_command",
  "Send a command to the connected Proxmark3 session and return the output.",
  commandSchema.shape,
  commandHandler(session),
);

server.tool(
  "pm3_status",
  "Check Proxmark3 session state and device info.",
  {},
  statusHandler(session),
);

server.tool(
  "pm3_disconnect",
  "Disconnect from Proxmark3 and close the session.",
  {},
  disconnectHandler(session),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
