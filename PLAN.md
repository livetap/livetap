# livetap — Build Plan

> Push live data streams into your AI coding agent.
> Connect MQTT, Kafka, or webhooks. Your agent samples, watches, and acts on real-time data through natural language.

## User Story (end-to-end)

```
User (in Claude Code): "Hey can you help me sample this MQTT stream at broker.emqx.io on topic sensors/#? Use livetap."

CC: Installs livetap, writes .mcp.json, tells user to restart.

User: Restarts CC with channels enabled.

User: "Ok you're back, can you tap that stream for me?"
CC: Calls create_connection → MQTT connects → data flows into Redis.
CC: Calls read_stream → samples latest messages → shows user the data.

User: "Cool, now set up a watcher for temp in Zone A > 50°C and write a summary line to output.txt"
CC: Calls create_watcher with expression {field: "sensors.temperature.value", op: ">", value: 50}
CC: Waits for channel alert...

[30 seconds later, temp spikes]
← livetap channel alert arrives in session

CC: Summarizes the alert in one line, appends to output.txt.
```

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package | Single `@livetap` on npm | One install, one binary. No split packages. |
| Runtime | Bun | Per CLAUDE.md. No Node/Express. |
| JustinX coupling | Fully standalone | livetap has zero JustinX awareness. Separate upgrade path. |
| Agent target (v0) | Claude Code only | Channels API. Codex support in v1. |
| Storage | Embedded Redis (redis-server npm) | Spawned as child process. No Docker. No in-memory fallback. |
| Watcher model | Expression-based (structured conditions) | Not full TypeScript scripts. Field/op/value triples evaluated in-process. |
| Watcher actions | Channel alert + configurable action | Default: push channel event. Optional: webhook POST, shell command. |
| MCP tools | Mirror JustinX tool surface | Same 11 tools. create_watcher takes expression instead of scriptContent. |
| Connection creation | CLI + agent (both paths) | `livetap connect <uri or json>` from terminal, or agent calls create_connection via MCP. |
| Multi-source | CLI for quick, config file for persistent | Ad-hoc: `livetap connect mqtt://...`. Persistent: livetap.json (v0.1). |
| Process model | Background daemon + thin MCP channel proxy | Daemon survives Claude restarts. MCP proxy is spawned by Claude, connects to daemon on :8788. |
| Daemon discovery | Fixed port :8788 | `LIVETAP_PORT` env var to override. |
| Install flow | postinstall writes .mcp.json | `npm install livetap` → postinstall adds MCP entry → user restarts Claude. |
| Persistence (v0) | Ephemeral — in Redis only | Connections/watchers lost on daemon stop. |
| Persistence (v0.1) | JSON config file | livetap.json stores connections + watchers. Restored on startup. |
| Sampling | Per-source configurable | `--sample 30s` flag. Smart defaults per protocol later. |
| NPM keywords | mqtt, kafka, websocket, webhook, streaming, real-time, monitoring, alerts, mcp, claude-code, ai-agent, iot, observability, data-pipeline |

## Architecture

### Process Model

```
livetap serve (background daemon on :8788)
  ├── redis-server (child process, auto-managed)
  ├── Connection Manager
  │     ├── MQTT subscribers
  │     ├── WebSocket subscribers (v1)
  │     ├── Webhook ingestors
  │     └── Kafka consumers (v1)
  ├── Watcher Engine (expression evaluator)
  │     └── evaluates conditions against stream entries
  └── HTTP API (:8788)
        ├── MCP tool endpoints (create_connection, read_stream, etc.)
        └── channel event push endpoint

Claude Code
  └── livetap-channel (thin MCP stdio proxy)
        ├── connects to daemon at localhost:8788
        ├── exposes MCP tools (proxied to daemon)
        └── pushes channel notifications into session
```

### Data Flow

```
MQTT Broker ──→ MQTT Subscriber ──→ Redis Stream ──→ Watcher Engine
                                         │                  │
                                         ▼                  ▼ (on match)
                                    read_stream tool    Channel Alert
                                    (agent samples)     ──→ MCP proxy
                                                        ──→ Claude Code
                                                        ──→ <channel> tag
```

## MCP Tool Surface

Mirrors JustinX. 11 tools:

### Connection Management
- **create_connection** — Create MQTT/Webhook/Kafka connection. Params: type, broker, port, tls, username, password, topics (+ kafka-specific: brokers, groupId, kafkaTopics, sasl).
- **list_connections** — List all active connections with status.
- **get_connection** — Get connection details (msg count, stream key, rate).
- **destroy_connection** — Stop connection, clean up Redis stream, kill watchers.

### Stream Reading
- **read_stream** — Read backfill + live entries from a connection's Redis stream. Params: connectionId, backfillSeconds (default 300), liveSeconds (default 3), maxEntries (default 50).

### Watcher Management
- **create_watcher** — Deploy expression watcher on a connection.
  ```json
  {
    "connectionId": "conn_abc",
    "conditions": [
      { "field": "sensors.temperature.value", "op": ">", "value": 50 }
    ],
    "match": "all",
    "action": "channel_alert"
  }
  ```
- **list_watchers** — List watchers for a connection.
- **get_watcher** — Get watcher details (expression, status, config).
- **get_watcher_logs** — Get watcher evaluation logs (matches, last checked).
- **update_watcher** — Update watcher expression or config. Restarts evaluation.
- **restart_watcher** — Restart a stopped watcher.
- **delete_watcher** — Stop and remove a watcher.

### Expression Format

Structured conditions (not arbitrary code):

```typescript
interface WatcherCondition {
  field: string;    // dot-path into parsed JSON payload, e.g. "sensors.temperature.value"
  op: ">" | "<" | ">=" | "<=" | "==" | "!=" | "contains";
  value: number | string | boolean;
}

interface WatcherConfig {
  conditions: WatcherCondition[];
  match: "all" | "any";           // AND vs OR
  action: "channel_alert"         // default: push <channel> event
         | { webhook: string }    // POST to URL
         | { shell: string };     // run command
  cooldown?: number;              // seconds between repeated alerts (default 60)
}
```

### Channel Alert Format

When a watcher fires, the channel event looks like:

```xml
<channel source="livetap" type="alert" watcher="w_abc" connection="conn_def">
{
  "expression": "sensors.temperature.value > 50",
  "matched": { "sensors.temperature.value": 52.3 },
  "entry": { "device": "sensor-zone-a", "topic": "sensors/telemetry", ... }
}
</channel>
```

## CLI Commands

```bash
# Server
livetap serve                    # Start daemon (Redis + API on :8788)
livetap stop                     # Stop daemon
livetap status                   # Show daemon status, connections, watchers

# Connections
livetap connect mqtt://broker.emqx.io/sensors/#       # Quick URI
livetap connect connection.json                         # Full config
livetap connections                                     # List
livetap disconnect <connectionId>                       # Remove

# Watchers
livetap watch <connectionId> --field temp --op gt --value 50
livetap watchers <connectionId>
livetap unwatch <connectionId> <watcherId>

# Sampling
livetap sample <connectionId>                           # Read latest entries
livetap sample <connectionId> --live 10                 # Stream for 10s
```

## Install Flow

```bash
# 1. User installs
npm install livetap

# 2. postinstall script runs:
#    - Detects .mcp.json (creates if missing)
#    - Adds livetap MCP server entry
#    - Prints restart instructions

# 3. User restarts Claude Code:
claude --dangerously-load-development-channels server:livetap

# 4. On startup, livetap-channel (MCP proxy):
#    - Checks if daemon is running on :8788
#    - If not, starts it in background (livetap serve)
#    - Connects and proxies MCP tools + channel events
```

## File Structure

```
@livetap/
├── bin/
│   └── livetap.ts              # CLI entry point
├── src/
│   ├── server/
│   │   ├── index.ts            # Daemon entry (Bun.serve on :8788)
│   │   ├── redis.ts            # Embedded redis-server lifecycle
│   │   ├── connection-manager.ts
│   │   ├── connections/
│   │   │   ├── mqtt.ts
│   │   │   ├── webhook.ts
│   │   │   └── kafka.ts        # v1
│   │   └── watchers/
│   │       ├── engine.ts       # Expression evaluator
│   │       └── types.ts
│   ├── mcp/
│   │   ├── channel.ts          # Thin MCP stdio proxy (channel + tools)
│   │   └── tools.ts            # Tool definitions (mirroring JustinX)
│   └── cli/
│       ├── serve.ts
│       ├── connect.ts
│       ├── status.ts
│       └── sample.ts
├── package.json
├── tsconfig.json
└── livetap.json                # Optional config file (v0.1)
```

## Protocols

### v0 (Launch)
- **MQTT** — tested, proven with broker.emqx.io demo
- **Webhooks** — HTTP ingest endpoint, simple

### v1
- **Kafka** — consumer group, SASL auth
- **WebSocket (source)** — unlocks finance, blockchain segments

### Future
- **SSE** — CI/CD events
- **gRPC streams** — blockchain, DevOps

## v0.1 Additions
- JSON config file persistence (livetap.json)
- `livetap export` / `livetap import`
- Per-protocol smart sampling defaults
- `livetap init` wizard

## Launch

### HN Title
> Show HN: livetap – Push live MQTT/Kafka/webhook streams into Claude Code

### npm Description
> Push live data streams into your AI coding agent. Connect MQTT, Kafka, or webhooks. Your agent samples, watches, and acts on real-time data through natural language.

### npm Keywords
mqtt, kafka, websocket, webhook, streaming, real-time, monitoring, alerts, mcp, claude-code, ai-agent, iot, observability, data-pipeline
