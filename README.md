# pm3-mcp

MCP server that gives AI assistants (Claude Code, etc.) direct access to a Proxmark3 RFID/NFC research tool through a persistent interactive session.

## What it does

The server spawns a Proxmark3 client process and keeps it alive across tool calls. You can ask Claude to read, write, clone, and analyze RFID/NFC cards without writing any pm3 commands yourself.

Example conversation:

```
You: "Scan whatever card is on the reader"
Claude: [calls pm3_connect, then pm3_command with "auto"]
Claude: "Found an EM 410x card with ID 1D00D2A924. This is a low-frequency
         125kHz proximity card commonly used for door access."

You: "Clone it to a T5577"
Claude: [calls pm3_command with "lf em 410x clone --id 1D00D2A924"]
Claude: "Done. The T5577 card now emulates your original EM 410x."
```

## Prerequisites

- **Node.js 18+**
- **Proxmark3 client** compiled and working ([RRG/Iceman fork](https://github.com/RfidResearchGroup/proxmark3))
  - Verify with: `pm3 --version` or `proxmark3 --version`
- Proxmark3 device connected via USB

## Installation

```bash
git clone https://github.com/anthropic/pm3-mcp.git
cd pm3-mcp
npm install
npm run build
```

## Configuration

All configuration is through environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PM3_BINARY_PATH` | No | Auto-detect via `which pm3` / `which proxmark3`, fallback `/usr/local/bin/pm3` | Path to pm3 binary |
| `PM3_IDLE_TIMEOUT` | No | `3000` | Idle timeout in ms (how long to wait after last output before considering command complete) |
| `PM3_MAX_TIMEOUT` | No | `120000` | Max timeout in ms for any single command |
| `PM3_DEBUG` | No | off | Set to `1` to enable debug logging to stderr |

## Claude Code setup

Add to your MCP configuration (`~/.claude/mcp.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "proxmark3": {
      "command": "node",
      "args": ["/absolute/path/to/pm3-mcp/dist/index.js"],
      "env": {
        "PM3_BINARY_PATH": "/path/to/your/proxmark3/pm3"
      }
    }
  }
}
```

Restart Claude Code to pick up the new MCP server.

## Tools reference

| Tool | Parameters | Description |
|------|-----------|-------------|
| `pm3_connect` | `port?` (string) — serial port, e.g. `/dev/ttyACM0` | Connect to Proxmark3. Auto-detects port if omitted. |
| `pm3_command` | `command` (string) — any pm3 command; `timeout_ms?` (number) — override max timeout | Send a command and get the response. |
| `pm3_status` | none | Check session state and device info. |
| `pm3_disconnect` | none | Disconnect and close the session. |

## State machine

```
DISCONNECTED ──connect()──> CONNECTING ──success──> CONNECTED
     ^                          |                      |
     |                        error                  error / process exit
     |                          |                      |
     |                          v                      v
     +────── disconnect() ── ERROR <───────────────────+
     |                          |
     +────── connect() ────────+  (auto-recovery: cleanup + reconnect)
```

- **DISCONNECTED**: No pm3 process running. Ready to connect.
- **CONNECTING**: Spawning pm3 process and waiting for banner.
- **CONNECTED**: Ready to accept commands. One command at a time.
- **ERROR**: Something went wrong. Call `pm3_connect` again to auto-recover.

## Troubleshooting

### "pm3 binary not found or not executable"
Set `PM3_BINARY_PATH` to the full path of your pm3/proxmark3 binary:
```bash
export PM3_BINARY_PATH=$(which pm3)
```

### "Not connected. Call connect() first."
The session is not active. Use `pm3_connect` before sending commands.

### "Another command is in progress"
Only one command runs at a time. Wait for the current command to finish.

### Empty output from commands
- The device may have been physically disconnected. The server will detect this and move to ERROR state.
- Some commands produce no output. Try `hw status` to verify the connection.

### "Already connected. Disconnect first."
Call `pm3_disconnect` before connecting again, or let error recovery handle it.

### Serial port permission denied
Add your user to the `dialout` group (Linux) or check USB permissions:
```bash
sudo usermod -aG dialout $USER
# Log out and back in
```

### pm3 process becomes zombie after server crash
If the MCP server crashes without cleanup, the pm3 process may hold the serial port:
```bash
pkill -f "pm3\|proxmark3"
```

## Limitations

- **Single device**: One Proxmark3 device per server instance.
- **No streaming**: Output is collected and returned after the command completes (idle timeout detection). No real-time streaming.
- **Serial port exclusive access**: Only one process can use the serial port at a time. Close other pm3 instances before connecting.
- **Idle timeout detection**: End-of-response is detected by output going silent for `PM3_IDLE_TIMEOUT` ms. Very slow commands may need a custom `timeout_ms`.

## Technical details

- **Transport**: stdio (MCP protocol over stdin/stdout)
- **Session model**: persistent child process with piped stdin/stdout
- **Logging**: all log output goes to stderr (stdout is reserved for MCP protocol)
- **Concurrency**: one command at a time per session, with mutex on connect/disconnect operations

## License

MIT
