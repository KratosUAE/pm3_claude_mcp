# pm-mcp

MCP server that wraps the [Proxmark3](https://github.com/RfidResearchGroup/proxmark3) interactive CLI, allowing AI assistants (Claude Code, etc.) to read, write, and analyze RFID/NFC cards through a persistent session.

## How it works

The server spawns a Proxmark3 client process and keeps it alive across tool calls. You send any pm3 command and get the output back — no need for individual tools per card type or protocol.

### Tools

| Tool | Description |
|------|-------------|
| `pm3_connect` | Connect to Proxmark3 (auto-detects port or specify manually) |
| `pm3_command` | Send any pm3 command and get the response |
| `pm3_status` | Check session state and device info |
| `pm3_disconnect` | Close the session |

## Setup

### Prerequisites

- [Proxmark3 client](https://github.com/RfidResearchGroup/proxmark3) compiled and working
- Node.js 18+

### Install

```bash
git clone https://github.com/YOUR_USER/pm-mcp.git
cd pm-mcp
npm install
```

Edit `src/config.ts` to point to your pm3 binary:

```typescript
pm3Binary: "/path/to/your/proxmark3/pm3",
```

Build:

```bash
npm run build
```

### Configure Claude Code

Add to your `.mcp.json` or Claude Code settings:

```json
{
  "mcpServers": {
    "proxmark3": {
      "command": "node",
      "args": ["/absolute/path/to/pm-mcp/dist/index.js"]
    }
  }
}
```

Restart Claude Code to pick up the new MCP server.

## Usage examples

Once connected, you can send any Proxmark3 command:

```
> pm3_connect
Connected. Using UART port /dev/ttyACM0

> pm3_command: auto
EM 410x ID 1D00D2A924 ...

> pm3_command: hf mf restore -f ./CARDS/hf-mf-7C73493D-dump.bin -k ./CARDS/hf-mf-7C73493D-key.bin
Done!

> pm3_command: lf search
GALLAGHER - Region: 6 Facility: 112 Card No.: 5685 ...
```

The pm3 process runs with its binary's directory as the working directory, so relative paths like `./CARDS/` resolve correctly regardless of where the MCP server is launched from.

## Technical details

- **Transport:** stdio (for Claude Code integration)
- **Session model:** persistent child process with piped stdin/stdout
- **End-of-response detection:** idle timeout (3s) — when pm3 stops producing output, the response is considered complete
- **Long commands:** pass `timeout_ms` parameter for operations like key cracking that take longer
- **Concurrency:** one command at a time per session

## License

MIT
