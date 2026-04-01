# LiveTap

> Push live data streams into your AI coding agent.

Connect MQTT brokers, WebSocket feeds, or tail log files. Your agent samples, watches, and acts on real-time data through natural language.

<!-- TODO: Add demo GIF here after recording -->
<!-- ![livetap demo](demo.gif) -->

## Quick start

**Requirements:** [Bun](https://bun.sh), Claude Code v2.1.80+

```bash
bun add livetap
```

Start the daemon and Claude Code:

```bash
livetap start
claude --dangerously-load-development-channels server:livetap
```

Then ask your agent:

> "Connect to the IoT demo at mqtt://broker.emqx.io on topic justinx/demo/# and watch for temperature above 23 degrees"

## Setup with Claude Code (for AI agents)

If you are Claude Code or another AI agent, run `npx livetap --llm-help` for structured setup instructions.

Quick version:

```bash
npm install livetap          # Step 1: install
npx livetap setup            # Step 2: creates .mcp.json
# Step 3: tell user to restart Claude Code with:
#   claude --dangerously-load-development-channels server:livetap --continue
```

**IMPORTANT — do NOT:**
- Add livetap to `~/.claude/mcp.json` — it goes in `.mcp.json` in the project root
- Configure livetap as `type: "http"` — it is a stdio MCP server (command + args)
- Start the daemon manually — the MCP proxy auto-starts it on Claude restart
- Guess field names — always `read_stream` first to see actual payload structure

### After restart — use MCP tools

Once restarted with the channel flag, you have 12 MCP tools available. Follow this workflow:

1. **CONNECT** — `create_connection({ type: "mqtt", broker: "broker.emqx.io", port: 1883, tls: false, topics: ["justinx/demo/#"] })`
2. **SAMPLE** — `read_stream({ connectionId: "conn_xxx", backfillSeconds: 60, maxEntries: 10 })` — ALWAYS sample first to see field paths
3. **WATCH** — `create_watcher({ connectionId: "conn_xxx", conditions: [{ field: "sensors.temperature.value", op: ">", value: 50 }], match: "all", cooldown: 60 })`

### Supported source types

| Type | create_connection params | CLI |
|------|------------------------|-----|
| MQTT | `{ type: "mqtt", broker: "host", port: 1883, tls: false, topics: ["topic/#"] }` | `livetap tap mqtt://host:1883/topic/#` |
| WebSocket | `{ type: "websocket", url: "wss://..." }` | `livetap tap wss://...` |
| File | `{ type: "file", path: "/var/log/app.log" }` | `livetap tap file:///var/log/app.log` |

### Data shape by source

- **MQTT/WebSocket (JSON):** payload is parsed. Use dot-paths: `sensors.temperature.value`
- **File (plain text):** field is `payload`. Use: `{ field: "payload", op: "contains", value: "ERROR" }` or `{ field: "payload", op: "matches", value: "5[0-9]{2}" }`
- **File (JSON lines):** parsed. Use dot-paths: `level`, `msg`
- **IMPORTANT:** always `read_stream` first. The field is `payload`, NOT `line` or `message`.

### Watcher operators

`>`, `<`, `>=`, `<=`, `==`, `!=`, `contains`, `matches` (regex)

### If the daemon is not running

The MCP proxy auto-starts the daemon. If it fails, run:
```bash
livetap start
```

## What it does

livetap runs a background daemon that connects to live data sources, buffers messages in memory, and pushes alerts into your Claude Code session via the [Channels API](https://code.claude.com/docs/en/channels). Your agent sees the data in real-time and can create expression-based watchers that fire when conditions match.

```
Source (MQTT/WS/File) ──> Subscriber ──> StreamStore ──> Watcher Engine
                                              |                 |
                                              v                 v (on match)
                                         read_stream        Channel Alert
                                         (agent samples)    ──> Claude Code
                                                            ──> agent acts
```

## Examples

### IoT sensor monitoring

```
You: "Connect to mqtt://broker.emqx.io:1883/justinx/demo/# and watch for temperature above 25°C"

Agent: Creates connection, samples the data to learn the payload structure,
       sets up watcher on sensors.environmental.temperature.value > 25.
       When it fires, summarizes: "sensor-zone-c hit 25.4°C at 10:05:08Z"
```

### Crypto price alerts

```
You: "Tap the Binance BTC/USDT trade stream and alert me if price drops below 60000"

Agent: Connects to wss://stream.binance.com:9443/ws/btcusdt@trade,
       samples to see the price field is "p" (string),
       sets up watcher with regex: p matches "^[1-5]" (prices starting with 1-5 = below 60k)
```

### Log file monitoring

```
You: "Watch my nginx error log for 5xx errors and summarize each one"

Agent: Taps file:///var/log/nginx/error.log,
       creates watcher: payload matches "5[0-9]{2}",
       when an error appears, analyzes it:
       "503 Service Unavailable on /api/data — upstream auth-service not responding"
```

### WiFi disconnect detection

```
You: "Monitor /var/log/wifi.log and alert me when WiFi drops"

Agent: Taps the file, samples to see log format, creates regex watcher
       for power state changes. When you toggle WiFi:
       "Wi-Fi powered OFF at 17:51:45, back ON at 17:51:47 (2s outage)"
```

## CLI

```bash
# Daemon
livetap start                                    # Start daemon (HTTP API)
livetap stop                                     # Stop
livetap status                                   # Dashboard

# Tap into data sources
livetap tap mqtt://broker.emqx.io:1883/sensors/# # MQTT broker
livetap tap wss://stream.binance.com:9443/ws/btcusdt@trade  # WebSocket
livetap tap file:///var/log/nginx/error.log       # Log file
livetap taps                                      # List active taps
livetap untap <connectionId>                      # Remove

# Sample data
livetap sip <connectionId>                        # Pretty JSON output
livetap sip <connectionId> --raw                  # Raw JSON

# Watchers
livetap watch <connId> "temperature > 50"                    # Numeric
livetap watch <connId> "payload matches 'ERROR|FATAL'"       # Regex
livetap watch <connId> "temp > 50 AND humidity > 90"         # AND
livetap watch <connId> "price > 70000" --cooldown 300        # Custom cooldown
livetap watchers                                             # List all
livetap watchers --logs <watcherId>                          # View logs
livetap unwatch <watcherId>                                  # Remove
```

## Supported sources

| Protocol | Example | Use case |
|----------|---------|----------|
| **MQTT** | `livetap tap mqtt://broker.emqx.io:1883/sensors/#` | IoT sensors, home automation |
| **WebSocket** | `livetap tap wss://stream.binance.com:9443/ws/btcusdt@trade` | Finance, real-time APIs |
| **File tailing** | `livetap tap file:///var/log/nginx/error.log` | Log monitoring, DevOps |
| Webhooks | Planned v0.1 | CI/CD, external services |
| Kafka | Planned v0.2 | Event sourcing, analytics |

## MCP tools

livetap exposes 12 MCP tools that your agent uses automatically:

| Tool | What it does |
|------|-------------|
| `create_connection` | Connect to MQTT, WebSocket, or file |
| `list_connections` | List active connections |
| `get_connection` | Connection details and stats |
| `destroy_connection` | Remove a connection |
| `read_stream` | Sample recent entries from a stream |
| `create_watcher` | Set up expression-based alerts |
| `list_watchers` | List watchers |
| `get_watcher` | Watcher details |
| `get_watcher_logs` | View MATCH/SUPPRESSED logs |
| `update_watcher` | Change conditions or cooldown |
| `delete_watcher` | Remove a watcher |
| `restart_watcher` | Restart a stopped watcher |

## Expression watchers

Watchers use structured conditions — not arbitrary code:

```json
{
  "conditions": [
    { "field": "sensors.temperature.value", "op": ">", "value": 50 },
    { "field": "sensors.humidity.value", "op": ">", "value": 90 }
  ],
  "match": "all",
  "cooldown": 60
}
```

**Operators:** `>`, `<`, `>=`, `<=`, `==`, `!=`, `contains`, `matches` (regex)

**Cooldown:** Seconds between repeated alerts. `0` for every match, `60` default.

When a watcher fires, the alert arrives as a `<channel>` tag in your Claude Code session. The agent reads it and acts — writing to a file, calling an API, or whatever you asked.

## How the agent uses livetap

The MCP instructions teach the agent this workflow:

1. **CONNECT** — `create_connection` to tap a source
2. **SAMPLE** — `read_stream` to see the data shape (always before creating watchers)
3. **WATCH** — `create_watcher` with the correct field paths
4. **ACT** — when `<channel>` alerts arrive, do what the user asked

The agent knows field paths differ by source:
- **MQTT/WebSocket:** JSON payload parsed — use dot-paths like `sensors.temperature.value`
- **File (text):** raw line in `payload` field — use `payload contains "ERROR"` or `payload matches "5[0-9]{2}"`
- **File (JSON lines):** parsed — use dot-paths like `level`, `msg`

## Configuration

**Daemon port:** Default `:8788`. Override with `--port` or `LIVETAP_PORT` env var.

**State directory:** `~/.livetap/` stores daemon PID, logs, and watcher evaluation logs.

**MCP config:** `.mcp.json` in your project root:
```json
{
  "mcpServers": {
    "livetap": {
      "command": "bun",
      "args": ["path/to/src/mcp/channel.ts"]
    }
  }
}
```

**Machine-readable help:** `livetap --llm-help` outputs structured JSON for AI agents.

## Development

```bash
git clone https://github.com/livetap/livetap.git
cd livetap && git checkout v0
bun install
bun test                         # 103 tests
bun test tests/phase1/           # Specific phase
SKIP_LIVE_MQTT=1 bun test        # Skip tests needing broker.emqx.io
```

See [docs/PLAN.md](docs/PLAN.md) for the full build plan with phased architecture.

## Contributing

1. Fork and clone
2. `bun install && bun test`
3. Make changes, add tests
4. `bun test` must pass
5. PR to `v0` branch

See [docs/PLAN.md](docs/PLAN.md) for architecture and module layout.

## License

MIT
