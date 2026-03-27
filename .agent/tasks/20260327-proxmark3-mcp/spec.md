# Proxmark3 MCP Server

## Overview
MCP server (TypeScript, stdio transport) that maintains a persistent interactive session with the Proxmark3 CLI client. Allows Claude to send any pm3 command and read responses through 4 tools.

## Tools

### pm3_connect
- **Input**: `{ port?: string }`
- **Behavior**: Spawns `proxmark3 <port>` (or `/home/kratos/proxmark3/pm3` for auto-detect). Waits for version banner. Sets state to CONNECTED.
- **Output**: Connection status + version banner text

### pm3_command
- **Input**: `{ command: string, timeout_ms?: number }`
- **Behavior**: Writes `command\n` to stdin. Accumulates stdout/stderr. Resolves when idle for 1000ms or max timeout hit.
- **Output**: `{ output: string, error: string, timed_out: boolean, duration_ms: number }`
- **Constraint**: One command at a time (reject concurrent calls)

### pm3_status
- **Input**: none
- **Output**: `{ state: "disconnected"|"connected"|"error", device_info?: string }`

### pm3_disconnect
- **Input**: none
- **Behavior**: Sends `exit\n`, waits 2s, kills process if still alive.

## Architecture

### Session Manager (`pm3-session.ts`)
- Singleton class managing one pm3 child process
- `child_process.spawn` with `stdio: ['pipe', 'pipe', 'pipe']`
- PM3 in pipe mode: no prompt, no ANSI colors (stdout not TTY)
- End-of-response: idle timeout (1000ms default, configurable per command)
- Max timeout: 120s default, overridable via `timeout_ms`
- Serialized commands: mutex pattern, reject if command in-flight
- Event handling: `close`/`exit`/`error` on child process -> state update

### Output Parser (`pm3-output-parser.ts`)
- Strip ANSI escape codes (defensive)
- Detect error markers: `[!!]` = error, `[!]` = warning
- Trim/clean output

### Config (`config.ts`)
- `PM3_BINARY`: `/home/kratos/proxmark3/pm3`
- `IDLE_TIMEOUT_MS`: 1000
- `MAX_TIMEOUT_MS`: 120000

### Entry Point (`index.ts`)
- `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`
- `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`
- Register 4 tools, create session singleton, connect transport

## Dependencies
- `@modelcontextprotocol/sdk` ^1.28.0
- `typescript` ^5.7.0
- `@types/node` ^22.0.0

## Error Handling
| Scenario | Response |
|----------|----------|
| Device not found | pm3 exits -> connect() rejects with error |
| Device disconnects | close event -> state = DISCONNECTED |
| Command timeout | Resolve with timed_out=true + partial output |
| Command while disconnected | Reject immediately |
| pm3 crash | exit event -> state = ERROR, cleanup |

## Integration
Claude Code config (`.mcp.json` or settings):
```json
{
  "mcpServers": {
    "proxmark3": {
      "command": "node",
      "args": ["/home/kratos/Dev/pm_mcp/dist/index.js"]
    }
  }
}
```
