import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PM3Session } from "./pm3-session.js";
import { resolveConfig } from "./config.js";
import { logger } from "./logger.js";
import { connectSchema, connectHandler } from "./tools/connect.js";
import { commandSchema, commandHandler } from "./tools/command.js";
import { statusHandler } from "./tools/status.js";
import { disconnectHandler } from "./tools/disconnect.js";

const config = resolveConfig();
const session = new PM3Session(config);

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

// Graceful shutdown handler
async function shutdown() {
  logger.debug("Shutting down, cleaning up pm3 session...");
  const timeout = setTimeout(() => {
    logger.error("Graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, 3000);
  timeout.unref();

  try {
    await session.disconnect();
    await server.close();
  } catch (err) {
    logger.error(`Shutdown cleanup error: ${err}`);
  }
  clearTimeout(timeout);
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function main() {
  logger.debug("MCP server starting");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.debug("MCP server connected to transport");
}

main().catch((err) => {
  logger.error(`Fatal: ${err}`);
  process.exit(1);
});
