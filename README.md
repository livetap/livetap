# livetap

Push live data streams into your AI coding agent.

Connect MQTT brokers, WebSocket feeds, or tail log files. Your agent samples, watches, and acts on real-time data through natural language.

## Quick start

**Requirements:** [Bun](https://bun.sh), [Redis](https://redis.io/docs/getting-started/installation/) (`brew install redis`), Claude Code v2.1.80+, claude.ai login

```bash
# Install
bun add livetap

# Start the daemon (embedded Redis + HTTP API on :8788)
bun node_modules/livetap/bin/livetap.ts start

# Start Claude Code with livetap channel
claude --dangerously-load-development-channels server:livetap
```

Then ask your agent:

> "Connect to mqtt://broker.emqx.io on topic justinx/demo/# (port 1883, no TLS), sample the data, then watch for temperature above 23°C"

## CLI

```bash
# Daemon
livetap start                                    # Start daemon (Redis + API)
livetap stop                                     # Stop daemon
livetap status                                   # Dashboard: connections, watchers, uptime

# Tap into data sources
livetap tap mqtt://broker.emqx.io:1883/sensors/# # MQTT
livetap tap wss://stream.example.com/prices       # WebSocket
livetap tap webhook                               # Webhook (returns ingest URL)
livetap taps                                      # List active taps
livetap untap <connectionId>                      # Remove a tap

# Sample data
livetap sip <connectionId>                        # Pretty-print recent entries
livetap sip <connectionId> --raw                  # Raw JSON

# Watchers
livetap watch <connId> "temperature > 50"                    # Simple
livetap watch <connId> "temp > 50 AND humidity > 90"         # AND
livetap watch <connId> "temp > 50 OR smoke > 0.05"           # OR
livetap watch <connId> "price > 70000" --cooldown 300        # 5min cooldown
livetap watchers                                             # List all watchers
livetap watchers --logs <watcherId>                          # View watcher logs
livetap unwatch <watcherId>                                  # Remove
```

## How it works

```
Source (MQTT/WS/Webhook) ──→ Subscriber ──→ Redis Stream ──→ Watcher Engine
                                                 │                  │
                                                 ▼                  ▼ (on match)
                                            read_stream         SSE /events
                                            (agent samples)     ──→ MCP proxy
                                                                ──→ Claude Code
                                                                ──→ <channel> tag
```

livetap runs as a background daemon with embedded Redis. Claude Code spawns a thin MCP channel proxy that connects to the daemon, proxies tool calls, and pushes watcher alerts into your session as `<channel>` tags.

### MCP tools (12 tools)

| Tool | Description |
|------|-------------|
| `create_connection` | Connect to MQTT broker, WebSocket URL, or create webhook endpoint |
| `list_connections` | List active connections with status and message rates |
| `get_connection` | Get connection details |
| `destroy_connection` | Remove a connection |
| `read_stream` | Sample recent entries from a connection's stream |
| `create_watcher` | Set up expression-based alerts (field/op/value conditions) |
| `list_watchers` | List watchers (optionally filter by connection) |
| `get_watcher` | Get watcher details by ID |
| `get_watcher_logs` | View MATCH/SUPPRESSED/ERROR logs |
| `update_watcher` | Change conditions, cooldown, or action |
| `delete_watcher` | Remove a watcher |
| `restart_watcher` | Restart a stopped watcher |

### Expression watchers

Watchers use structured conditions, not arbitrary code:

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

Supported operators: `>`, `<`, `>=`, `<=`, `==`, `!=`, `contains`, `matches` (regex)

When a watcher fires, the alert arrives as a `<channel>` tag in your Claude Code session. The agent reads it and acts — logging to a file, calling an API, or whatever you asked for.

## Supported sources

| Protocol | Status | Example |
|----------|--------|---------|
| MQTT | Working | `livetap tap mqtt://broker.emqx.io:1883/sensors/#` |
| WebSocket | Working | `livetap tap wss://stream.example.com/prices` |
| File tailing | Working | `livetap tap file:///var/log/nginx/error.log` |
| Webhooks | Planned (v0.1) | — |
| Kafka | Planned (v0.2) | — |

## Development

```bash
git clone https://github.com/livetap/livetap.git
cd livetap && git checkout v0
bun install
bun test                    # 56 tests
bun test tests/phase1/      # specific phase
```

See [docs/PLAN.md](docs/PLAN.md) for the full build plan.

## License

MIT
