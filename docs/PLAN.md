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
| Connection creation | CLI + agent (both paths) | `livetap tap <uri or json>` from terminal, or agent calls create_connection via MCP. |
| Multi-source | CLI for quick, config file for persistent | Ad-hoc: `livetap tap mqtt://...`. Persistent: livetap.json (v0.1). |
| Process model | Background daemon + thin MCP channel proxy | Daemon survives Claude restarts. MCP proxy is spawned by Claude, connects to daemon on :8788. |
| Daemon discovery | Fixed port :8788 | `LIVETAP_PORT` env var to override. |
| Install flow | postinstall writes .mcp.json | `npm install livetap` → postinstall adds MCP entry → user restarts Claude. |
| Persistence (v0) | Ephemeral — in Redis only | Connections/watchers lost on daemon stop. |
| Persistence (v0.1) | JSON config file | livetap.json stores connections + watchers. Restored on startup. |
| Sampling | Per-source configurable | `--sample 30s` flag. Smart defaults per protocol later. |
| NPM keywords | mqtt, kafka, websocket, webhook, streaming, real-time, monitoring, alerts, mcp, claude-code, ai-agent, iot, observability, data-pipeline |

## Build Phases

Each phase has a clear "done" gate: automated tests pass + manual smoke test.
Tests live in `tests/` and run with `bun test`. Each phase adds tests for its own scope.

### Phase 0: Channel proof-of-concept — DONE

**Built:** `scripts/livetap-channel.ts` (MCP channel server) + `scripts/mqtt-bridge.ts` (MQTT sampler)
**Tested:** curl POST → channel event arrives in Claude Code session. Live MQTT from broker.emqx.io confirmed.
**Branch:** `v0` (4 commits, pushed)

---

### Shared Foundation: Command Catalog (built incrementally across phases)

**Single source of truth** for all tool definitions, CLI commands, and agent instructions:

**File:** `src/shared/command-catalog.ts`

```typescript
export interface CatalogTool {
  name: string;                    // MCP tool name: "create_connection"
  description: string;             // Shared description for MCP + CLI + llm-help
  cli?: string;                    // CLI equivalent: "livetap tap <uri|file.json>"
  params: Record<string, {         // Zod-compatible param definitions
    type: string;
    description: string;
    required?: boolean;
    default?: unknown;
    enum?: string[];
  }>;
  examples: {
    description: string;           // "Connect to MQTT broker"
    cli?: string;                  // "livetap tap mqtt://broker.emqx.io:1883/sensors/#"
    tool?: string;                 // '{ type: "mqtt", broker: "broker.emqx.io", ... }'
  }[];
}

export interface CatalogDaemonCommand {
  cli: string;                     // "livetap start"
  description: string;
  flags?: { name: string; type: string; default?: unknown; description: string }[];
}

export const COMMAND_CATALOG: {
  tools: CatalogTool[];
  daemon: CatalogDaemonCommand[];
} = { /* ... */ }
```

**Consumed by 4 outputs from the same source:**

| Consumer | File | What it generates |
|----------|------|-------------------|
| MCP tool registration | `src/mcp/tools.ts` | Zod schemas from `params`, tool names + descriptions |
| LLM instructions | `src/mcp/channel.ts` | `instructions` string with workflow, tool usage, examples |
| Human CLI help | `bin/livetap.ts --help` | Formatted help text with commands + flags |
| Agent CLI help | `bin/livetap.ts --llm-help` | Machine-readable JSON for agents running CLI commands |

**Generator functions** in `src/shared/catalog-generators.ts`:
```typescript
// For MCP instructions string (injected into channel.ts)
export function generateInstructions(catalog: typeof COMMAND_CATALOG): string

// For --help (human-readable)
export function generateHelpText(catalog: typeof COMMAND_CATALOG): string

// For --llm-help (JSON for agents)
export function generateLlmHelp(catalog: typeof COMMAND_CATALOG): object
```

**`livetap --llm-help` output:**
```json
{
  "name": "livetap",
  "version": "0.1.0",
  "commands": [
    {
      "name": "connect",
      "usage": "livetap tap <source>",
      "description": "Connect to a data source",
      "args": [{ "position": 0, "name": "source", "required": true }],
      "flags": [
        { "name": "--name", "type": "string", "description": "Display name" },
        { "name": "--sample", "type": "string", "description": "Sample interval (e.g. 30s)" }
      ],
      "examples": [
        "livetap tap mqtt://broker.emqx.io:1883/sensors/#",
        "livetap tap wss://stream.example.com/prices",
        "livetap tap webhook",
        "livetap tap connection.json"
      ]
    }
  ],
  "mcp_tools": [
    {
      "name": "create_connection",
      "description": "Create a data connection...",
      "params": { "type": { "type": "string", "enum": ["mqtt", "webhook", "websocket"] }, "..." : "..." }
    }
  ]
}
```

**Build schedule:** The catalog file is created in Phase 1 with connection tools, extended in Phase 3 with watcher tools, and consumed by Phase 2 (MCP instructions) and Phase 4 (CLI help/llm-help). Each phase adds its entries to the same file.

**Tests** (added to Phase 4):
```
tests/phase4/
├── catalog-sync.test.ts       # Verify every MCP tool has a CLI example, every CLI command maps to a tool
├── llm-help.test.ts           # livetap --llm-help → parse JSON → verify all commands present + valid schema
└── instructions-gen.test.ts   # generateInstructions() → verify contains all tool names, examples, workflow steps
```

---

### Phase 1: Embedded Redis + Connection Manager

**Goal:** `livetap start` boots embedded Redis, accepts create_connection via HTTP API, subscribers write to Redis streams with rolling retention, read_stream returns entries.

**Build:**
- `src/server/redis.ts` — spawn redis-server from `redis-server` npm binary, wait for ready, health check, shutdown. Uses random port to avoid conflicts.
- `src/server/connection-manager.ts` — create/list/get/destroy connections, generate conn IDs (`conn_` + 8 hex chars). Tracks msg/sec and buffered count per connection.
- `src/server/connections/mqtt.ts` — MQTT subscriber using `mqtt` package, writes to Redis stream via XADD. Rolling retention via `XTRIM MINID ~` after each write (default 5 min, matching JustinX).
- `src/server/connections/webhook.ts` — HTTP ingest endpoint per connection. Each POST → XADD to connection's stream. Same XTRIM retention. Returns connection ID in response so caller can correlate.
- `src/server/connections/websocket.ts` — WebSocket client connecting to a remote WS source, each message → XADD. Reconnects with exponential backoff on disconnect. Same XTRIM retention.
- `src/server/connections/subscriber.ts` — Base subscriber interface (start/stop/getStatus). All three protocols implement this.
- `src/server/index.ts` — Bun.serve on :8788, routes for create_connection, list_connections, get_connection, destroy_connection, read_stream
- `src/server/types.ts` — ConnectionConfig (discriminated union: mqtt | webhook | websocket), ConnectionStatus, StreamEntry (mirroring JustinX types)

**Rolling retention (from JustinX pattern):**
```typescript
// After each XADD, trim entries older than retentionMs (default 5 minutes)
const minId = Date.now() - retentionMs;
await redis.xtrim(streamKey, 'MINID', '~', minId.toString());
```
This keeps Redis memory bounded. `~` allows Redis to trim efficiently (approximate).

**Tests** (`bun test`):
```
tests/phase1/
├── redis.test.ts              # Boot embedded redis on random port, ping, XADD/XRANGE, shutdown
├── connection-manager.test.ts # Create/list/get/destroy lifecycle, verify conn IDs
├── mqtt-connection.test.ts    # MQTT subscriber → Redis (uses broker.emqx.io, skip with SKIP_LIVE_MQTT=1)
├── webhook-connection.test.ts # Simulated webhook sender → POST to ingest → verify entries in Redis via XRANGE
├── ws-connection.test.ts      # Simulated WS server → WS subscriber connects → verify entries in Redis
├── read-stream.test.ts        # Write test entries to Redis → read_stream HTTP endpoint returns them
├── retention.test.ts          # Write entries with old timestamps → verify XTRIM removes them after retention window
└── http-api.test.ts           # Full HTTP API: POST /connections → GET /connections → GET /connections/:id → DELETE
```

**Simulated data senders (in `tests/fixtures/`):**

These are reusable test utilities, not just one-off scripts. Each returns a handle with `start()`, `stop()`, and `sentCount`.

- `webhook-sender.ts` — Starts sending POST requests with JSON sensor payloads to a target URL every 500ms. Payloads cycle through 3 simulated sensors (zone-a, zone-b, zone-c) with randomized temp/humidity/smoke values.
  ```typescript
  const sender = createWebhookSender({ targetUrl: ingestUrl, intervalMs: 500 })
  await sender.start()
  // ... test ...
  await sender.stop()
  expect(sender.sentCount).toBeGreaterThan(5)
  ```

- `ws-server.ts` — Bun WebSocket server on random port. Sends JSON sensor data every 500ms. Supports `dropConnection()` for reconnect testing and `setPayload()` for custom data.
  ```typescript
  const server = createWsServer({ intervalMs: 500 })
  const { port } = await server.start()
  // create_connection({ type: 'websocket', url: `ws://localhost:${port}` })
  // ... test ...
  await server.stop()
  ```

- `mqtt-publisher.ts` — Publishes to a unique temp topic on broker.emqx.io every 500ms. Topic includes random suffix to avoid collisions. Skippable via `SKIP_LIVE_MQTT=1`.

- `tests/fixtures/payloads/` — Static JSON payloads:
  - `sensor-telemetry.json` — multi-zone environmental sensor (matches broker.emqx.io demo format)
  - `ci-webhook.json` — simulated GitHub Actions webhook (build failed)
  - `price-tick.json` — simulated financial WebSocket price update

**Done gate:**
- `bun test tests/phase1/` passes (~10 tests)
- Manual: `bun src/server/index.ts` → curl create MQTT connection → curl read_stream → see live data → wait 5 min → verify old entries trimmed

---

### Phase 2: MCP proxy + Channel delivery

**Goal:** Thin MCP stdio proxy spawned by Claude Code. Proxies all tool calls to the daemon on :8788. Pushes channel alerts from daemon into Claude Code session. Agent has clear instructions on how to use livetap.

**Build:**
- `src/mcp/channel.ts` — MCP Server (stdio transport) with `claude/channel` capability. On startup, connects to daemon at `localhost:8788`. If daemon not running, auto-starts it via Bun.spawn. Registers all 11 MCP tools as proxies (tool call → HTTP POST to daemon → return result). Listens for alert events from daemon via SSE/polling and forwards as `notifications/claude/channel`.
- `src/mcp/tools.ts` — Tool definitions (zod schemas mirroring JustinX). Shared between channel proxy and HTTP API.
- Update `.mcp.json` to point to `src/mcp/channel.ts`

**Daemon → Proxy alert delivery:**
- Daemon exposes `GET /events` (SSE stream). When a watcher fires or a sampled message arrives, daemon pushes an event.
- MCP proxy holds an SSE connection to daemon, converts each event to `mcp.notification({ method: 'notifications/claude/channel', ... })`

**LLM Instructions (critical for agent UX):**

The MCP server's `instructions` field is what teaches the agent how to use livetap. This must be carefully written:

```typescript
instructions: `
You have access to livetap, a live data streaming tool. Use it to connect to data sources and monitor them.

WORKFLOW:
1. CONNECT: Use create_connection to tap into a data source (MQTT broker, WebSocket URL, or webhook).
   - MQTT: create_connection({ type: "mqtt", broker: "hostname", port: 1883, topics: ["topic/#"] })
   - WebSocket: create_connection({ type: "websocket", url: "wss://..." })
   - Webhook: create_connection({ type: "webhook" }) → returns an ingest URL

2. SAMPLE: Use read_stream to see what data is flowing through a connection.
   - read_stream({ connectionId: "conn_xxx", backfillSeconds: 60, maxEntries: 10 })
   - Look at the data structure to understand field paths for watchers.

3. WATCH: Use create_watcher to set up alerts on conditions.
   - create_watcher({ connectionId: "conn_xxx", conditions: [{field: "path.to.value", op: ">", value: 50}], match: "all" })
   - Alerts arrive as <channel> events. When you see one, act on it as the user requested.

4. MANAGE: Use list_connections, list_watchers, destroy_connection, delete_watcher to manage.

CHANNEL EVENTS:
- <channel source="livetap" type="alert"> = a watcher condition matched. Read the payload and act.
- <channel source="livetap" type="sample"> = periodic data sample. Informational.

When the user asks to "monitor", "watch", or "alert on" something:
1. First sample the stream to understand the data shape
2. Then create a watcher with the right field paths
3. Tell the user what you set up and what will trigger it
`
```

**Local state: `~/.livetap/`**

Single state file + log directory:
```
~/.livetap/
├── state.json           # Daemon PID, port, Redis port — one file, not three
└── logs/
    ├── daemon.log       # Daemon stdout/stderr
    └── watchers/
        └── w_abc.log    # Per-watcher evaluation log (matches, errors, last checked)
```

- `state.json` — written on startup, removed on clean shutdown. Contains `{ pid, port, redisPort, startedAt }`. If PID file exists but process is dead, `livetap start` cleans up and starts fresh.
- `logs/watchers/w_abc.log` — each watcher writes its evaluation activity here: conditions checked, matches found, errors. This is the data source for **get_watcher_logs** MCP tool / `livetap watcher-logs` CLI. Capped at 1000 lines with rotation.
- In v0.1: `state.json` expands to include `connections` and `watchers` arrays for persistence across restarts.

**Tests:**
```
tests/phase2/
├── mcp-proxy.test.ts          # Start daemon + proxy, call tools via MCP client, verify responses
├── channel-delivery.test.ts   # Daemon sends SSE event → proxy converts to channel notification → verify format
├── tool-proxy.test.ts         # Each of the 11 tools: call via proxy → verify daemon receives correct HTTP request
├── auto-start.test.ts         # MCP proxy starts with no daemon → verify it spawns daemon automatically
├── instructions.test.ts       # Verify MCP server instructions string contains required keywords/sections
└── config-dir.test.ts         # Verify ~/.livetap/ created, PID file written, cleaned up on stop
```

**Done gate:**
- `bun test tests/phase2/` passes (~6 tests)
- Manual: Start Claude Code with `--dangerously-load-development-channels server:livetap` → agent calls create_connection + read_stream → sees live MQTT data via MCP tools → agent understands the workflow from instructions alone

---

### Phase 3: Expression watchers

**Goal:** create_watcher with structured conditions. Watcher engine evaluates incoming stream entries against expressions. On match, fires channel alert via SSE → proxy → Claude Code. Watcher logs are written to disk and queryable via get_watcher_logs.

**Build:**

**Types** — `src/server/watchers/types.ts`:
```typescript
interface WatcherCondition {
  field: string;       // dot-path: "sensors.temperature.value"
  op: '>' | '<' | '>=' | '<=' | '==' | '!=' | 'contains';
  value: number | string | boolean;
}

type WatcherAction =
  | 'channel_alert'                    // push <channel> event (default)
  | { webhook: string }               // POST to URL
  | { shell: string }                 // run command

interface WatcherDefinition {
  id: string;                          // "w_" + 8 hex chars
  connectionId: string;
  conditions: WatcherCondition[];
  match: 'all' | 'any';               // AND vs OR
  action: WatcherAction;
  cooldown: number;                    // seconds between repeated alerts (default 60)
  status: 'running' | 'stopped';
  createdAt: string;
  updatedAt: string;
  // Runtime stats (not persisted)
  lastChecked?: string;                // ISO timestamp
  matchCount?: number;
  lastMatch?: string;                  // ISO timestamp
}
```

**Watcher Manager** — `src/server/watchers/manager.ts`:
- CRUD operations: create, list, get, update, delete, restart
- Stores watcher definitions in Redis hashes: `livetap:watchers:{connectionId}:{watcherId}`
- On create/restart, spawns an evaluator loop for the watcher
- On delete/stop, kills the evaluator loop
- Generates watcher IDs: `w_` + 8 hex chars

**Expression Engine** — `src/server/watchers/engine.ts`:
- One evaluator loop per watcher (async function, not a child process)
- Reads from the connection's Redis stream via XREAD BLOCK (2s timeout)
- For each entry:
  1. Parse `payload` field as JSON
  2. For each condition, resolve dot-path field, apply operator
  3. Combine with match mode (all = AND, any = OR)
  4. If match AND cooldown elapsed since last match:
     - Execute action (channel_alert → push to SSE, webhook → fetch POST, shell → Bun.spawn)
     - Write log entry to `~/.livetap/logs/watchers/{watcherId}.log`
     - Update runtime stats (matchCount, lastMatch)
  5. If no match, still log periodically (every 100 entries checked) for debugging

**LLM guardrails — keeping the agent within the lines:**

The tool schema IS the guardrail. The agent cannot pass arbitrary code — zod validation rejects anything that doesn't match the structured condition format. Specific protections:

1. **No arbitrary code execution.** `create_watcher` only accepts `{ conditions, match, action }` — not scripts. If the agent hallucinates a `scriptContent` param, zod rejects it.
2. **Invalid dot-paths fail safe.** If a field path doesn't exist in the payload, `resolveDotPath` returns `undefined`, the condition evaluates to `false`, and the watcher logs `FIELD_NOT_FOUND`. No crash, no error, just no match.
3. **Validation errors return helpful messages.** If the agent passes an unsupported operator or malformed condition, the tool returns an error like: `"Invalid op 'matches' — supported: >, <, >=, <=, ==, !=, contains"`. This teaches the agent what's allowed.
4. **Instructions explicitly list what's possible.** The MCP instructions string includes the exact condition format and all supported operators. The agent doesn't need to guess.
5. **read_stream before watch.** Instructions tell the agent to sample first, then create the watcher. This means the agent sees real field paths before writing conditions, reducing dot-path errors.

Tool error responses:
```typescript
// Field path doesn't exist in any sampled entries
{ error: "Field 'sensors.foo.bar' not found in recent stream entries. Use read_stream to inspect the data shape." }

// Invalid operator
{ error: "Invalid op 'matches'. Supported: >, <, >=, <=, ==, !=, contains" }

// Empty conditions array
{ error: "At least one condition is required." }
```

**Dot-path resolver:**
```typescript
// resolveDotPath({ sensors: { temperature: { value: 42 } } }, "sensors.temperature.value")
// → 42
// resolveDotPath({ sensors: {} }, "sensors.temperature.value")
// → undefined (safe — condition returns false)
function resolveDotPath(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => o?.[k], obj)
}
```

**Expression evaluation:**
```typescript
function evaluateCondition(payload: any, condition: WatcherCondition): boolean {
  const value = resolveDotPath(payload, condition.field)
  if (value === undefined) return false  // field not found → no match, logged as FIELD_NOT_FOUND
  switch (condition.op) {
    case '>':        return value > condition.value
    case '<':        return value < condition.value
    case '>=':       return value >= condition.value
    case '<=':       return value <= condition.value
    case '==':       return value == condition.value
    case '!=':       return value != condition.value
    case 'contains': return String(value).includes(String(condition.value))
  }
}

function evaluateWatcher(payload: any, watcher: WatcherDefinition): boolean {
  const results = watcher.conditions.map(c => evaluateCondition(payload, c))
  return watcher.match === 'all' ? results.every(Boolean) : results.some(Boolean)
}
```

**Cooldown — exposed to the agent:**

Cooldown is a first-class parameter on `create_watcher`, controllable by the agent:
```json
{
  "connectionId": "conn_abc",
  "conditions": [{ "field": "sensors.temperature.value", "op": ">", "value": 50 }],
  "match": "all",
  "action": "channel_alert",
  "cooldown": 60
}
```
- Default: 60 seconds. Agent can set `0` for every-match alerting (useful for rare events like CI failures) or `300` for noisy streams.
- `update_watcher` can change cooldown without recreating the watcher.
- MCP instructions tell the agent: *"Set cooldown based on expected frequency. Use 0 for rare events (webhooks), 30-60 for moderate streams (MQTT sensors), 300+ for high-frequency streams."*

**Watcher log format** (`~/.livetap/logs/watchers/w_abc.log`):
```
[2026-03-31T10:00:01Z] STARTED conditions=sensors.temperature.value>50 match=all cooldown=60s
[2026-03-31T10:00:08Z] MATCH sensors.temperature.value=52.3 action=channel_alert
[2026-03-31T10:00:35Z] SUPPRESSED sensors.temperature.value=51.1 (cooldown 25s remaining)
[2026-03-31T10:01:10Z] MATCH sensors.temperature.value=53.7 action=channel_alert
[2026-03-31T10:05:00Z] CHECKPOINT entries_checked=500 matches=2 field_not_found=0
[2026-03-31T10:05:02Z] FIELD_NOT_FOUND sensors.foo.bar in entry 1774886702000-0
```

**Log explosion protection:**
- **Max file size: 512KB.** Checked on every write. When exceeded, truncate file to last 256KB (keep the tail, which is most recent and most useful for debugging).
- **CHECKPOINT lines** replace verbose CHECKED lines — written once every 5 minutes (not every 100 entries). Contains aggregate stats only.
- **FIELD_NOT_FOUND** logged at most once per field per minute (not every entry) to avoid spam from misconfigured watchers.
- **MATCH and SUPPRESSED** always logged — these are the important events.
- `get_watcher_logs` reads the file and returns the last N lines (default 50, max 200).
- On `delete_watcher`, log file is deleted.

**Channel alert payload** (pushed via SSE → MCP proxy → Claude Code):
```xml
<channel source="livetap" type="alert" watcher="w_abc" connection="conn_def">
{
  "watcher": "w_abc",
  "expression": "sensors.temperature.value > 50",
  "matched_values": { "sensors.temperature.value": 52.3 },
  "entry": {
    "topic": "justinx/demo/sensor-zone-a/telemetry",
    "payload": { "sensors": { "temperature": { "value": 52.3 }, ... } },
    "ts": 1774886400000
  }
}
</channel>
```

**Webhook action** — when action is `{ webhook: "https://example.com/hook" }`:
```typescript
await fetch(action.webhook, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ watcher: watcherId, expression, matched_values, entry })
})
```

**Shell action** — when action is `{ shell: "echo 'ALERT' >> /tmp/alerts.txt" }`:
```typescript
Bun.spawn(['sh', '-c', action.shell], {
  env: { ...process.env, LIVETAP_WATCHER: watcherId, LIVETAP_PAYLOAD: JSON.stringify(entry) }
})
```

**HTTP routes added to daemon:**
```
POST   /watchers                        → create_watcher
GET    /watchers?connectionId=conn_xxx  → list_watchers
GET    /watchers/:watcherId             → get_watcher
GET    /watchers/:watcherId/logs        → get_watcher_logs (reads from log file)
PUT    /watchers/:watcherId             → update_watcher (stops evaluator, updates definition, restarts)
POST   /watchers/:watcherId/restart     → restart_watcher
DELETE /watchers/:watcherId             → delete_watcher (stops evaluator, removes from Redis, deletes log file)
```

**Tests:**
```
tests/phase3/
├── dot-path.test.ts           # Unit: resolveDotPath on nested objects, arrays, missing fields, edge cases
├── expression-eval.test.ts    # Unit: evaluateCondition for all 7 operators + evaluateWatcher for all/any match modes
├── watcher-lifecycle.test.ts  # Integration: create/list/get/update/delete watchers via HTTP API, verify Redis state
├── watcher-trigger.test.ts    # Integration: create webhook connection + watcher → webhook-sender pushes matching data → verify SSE alert fires
├── watcher-no-match.test.ts   # Integration: watcher with high threshold → push data below threshold → verify NO alert fires
├── watcher-cooldown.test.ts   # Integration: rapid matches → verify only 1 alert per cooldown window, SUPPRESSED in logs
├── watcher-actions.test.ts    # Integration: test all 3 action types:
│                              #   - channel_alert → SSE event emitted
│                              #   - webhook → mock HTTP server receives POST
│                              #   - shell → verify file written by shell command
├── watcher-logs.test.ts       # Integration: create watcher → push data → GET /watchers/:id/logs → verify log format
├── watcher-log-size.test.ts   # Unit: write >512KB to log → verify truncated to ~256KB, tail preserved
├── watcher-field-missing.test.ts # Integration: watcher with bad dot-path → push data → no crash, FIELD_NOT_FOUND logged (max 1/min)
└── watcher-validation.test.ts # Unit: invalid op, empty conditions, malformed condition → verify helpful error messages
```

**Simulated trigger scenarios (all using webhook-sender from Phase 1 fixtures):**

1. **Happy path:** Create webhook connection → create watcher `sensors.temperature.value > 40` → sender pushes `{sensors:{temperature:{value:42}}}` → SSE alert fires → log shows MATCH
2. **No match:** Same setup but threshold is 100 → sender pushes value 42 → no alert → log shows CHECKED with 0 matches
3. **Cooldown:** Threshold 40, cooldown 5s → sender pushes 42 every 500ms → first match triggers alert, next 9 are suppressed, 5s later next match triggers again
4. **Multiple conditions (AND):** `temp > 40 AND humidity > 80` → sender pushes `{temp:42, humidity:75}` → no match. Then pushes `{temp:42, humidity:85}` → match.
5. **Multiple conditions (OR):** `temp > 40 OR smoke > 0.05` → sender pushes `{temp:35, smoke:0.06}` → match (smoke triggered).
6. **Webhook action:** Watcher with `{ webhook: "http://localhost:{mock-port}/hook" }` → match → verify mock server received POST with correct payload.
7. **Shell action:** Watcher with `{ shell: "echo $LIVETAP_PAYLOAD >> /tmp/livetap-test.txt" }` → match → verify file contains payload.

**Done gate:**
- `bun test tests/phase3/` passes (~12 tests)
- Manual: In Claude Code, tell agent "watch sensor-zone-a for temperature above 25°C" → agent calls read_stream to learn data shape → creates watcher → alert fires within 30s → agent reports it

---

### Phase 4: CLI

**Goal:** Human-facing CLI for managing livetap outside of the agent. `livetap start/stop/status` for the daemon, `livetap tap/untap/taps` for sources, `livetap sip` for quick stream inspection, `livetap watch/unwatch/watchers` for watcher management.

**Build:**

**CLI entry point** — `bin/livetap.ts`:
```typescript
#!/usr/bin/env bun
const [cmd, ...args] = Bun.argv.slice(2)

const commands: Record<string, () => Promise<void>> = {
  start:       () => import('../src/cli/start.js').then(m => m.run(args)),
  stop:        () => import('../src/cli/stop.js').then(m => m.run(args)),
  status:      () => import('../src/cli/status.js').then(m => m.run(args)),
  tap:         () => import('../src/cli/tap.js').then(m => m.run(args)),
  untap:       () => import('../src/cli/untap.js').then(m => m.run(args)),
  taps:        () => import('../src/cli/taps.js').then(m => m.run(args)),
  sip:         () => import('../src/cli/sip.js').then(m => m.run(args)),
  watch:       () => import('../src/cli/watch.js').then(m => m.run(args)),
  unwatch:     () => import('../src/cli/unwatch.js').then(m => m.run(args)),
  watchers:    () => import('../src/cli/watchers.js').then(m => m.run(args)),
  help:        () => import('../src/cli/help.js').then(m => m.run(args)),
}

if (!cmd || cmd === '--help' || cmd === '-h') { commands.help(); }
else if (commands[cmd]) { await commands[cmd](); }
else { console.error(`Unknown command: ${cmd}. Run 'livetap help' for usage.`); process.exit(1); }
```

No arg-parsing framework — just `Bun.argv` and simple flag parsing. Each command module exports `run(args: string[])`.

**Commands in detail:**

**`livetap start`** — `src/cli/start.ts`:
- Check if daemon already running (read `~/.livetap/state.json`, ping the port)
- If running: print status and exit
- If not: spawn daemon in background via `Bun.spawn` with `detached: true`, redirect stdout/stderr to `~/.livetap/logs/daemon.log`
- Wait up to 5s for daemon to write `state.json` and respond to health check
- Print: `livetap daemon started on :8788 (pid 12345)`
- Flags: `--port 9999` (override), `--foreground` (don't detach — useful for debugging)

**`livetap stop`** — `src/cli/stop.ts`:
- Read `~/.livetap/state.json` for PID
- If no state file or PID not running: print `livetap is not running` and exit
- Send `SIGTERM` to PID, wait up to 5s for process to exit
- If still running after 5s: `SIGKILL`
- Clean up `state.json`
- Print: `livetap daemon stopped`

**`livetap status`** — `src/cli/status.ts`:
- Read `~/.livetap/state.json` for port
- GET `http://localhost:{port}/status` — daemon returns JSON with connections, watchers, uptime, Redis status
- Pretty-print:
```
livetap daemon running on :8788 (pid 12345, uptime 2h 15m)
Redis: localhost:16379 (memory: 2.1MB)

Connections (3):
  conn_a1b2c3d4  mqtt    broker.emqx.io/sensors/#        12 msg/s  1,847 buffered
  conn_e5f6a7b8  webhook http://localhost:8788/ingest/..   0 msg/s     23 buffered
  conn_c9d0e1f2  ws      wss://stream.example.com/prices  45 msg/s  3,201 buffered

Watchers (2):
  w_1a2b3c4d  conn_a1b2c3d4  sensors.temperature.value > 50  running  3 matches  last: 2m ago
  w_5e6f7a8b  conn_c9d0e1f2  price > 50000                   running  0 matches
```
- If daemon not running: `livetap is not running. Use 'livetap start' to begin.`

**`livetap tap <uri-or-file>`** — `src/cli/tap.ts`:
- If arg ends in `.json`: read file, parse as ConnectionConfig, POST to daemon
- If arg starts with `mqtt://`: parse URI into MqttConnectionConfig
  - `mqtt://user:pass@host:port/topic/path/#` → `{ type: 'mqtt', broker: host, port, credentials: {user, pass}, topics: ['topic/path/#'] }`
- If arg starts with `ws://` or `wss://`: parse as WebSocket
  - `wss://stream.example.com/prices` → `{ type: 'websocket', url: arg }`
- If arg is `webhook`: create webhook connection, print ingest URL
  - `livetap tap webhook` → `{ type: 'webhook' }` → prints `Webhook ingest URL: http://localhost:8788/ingest/conn_xxx`
- POST to `http://localhost:{port}/connections`
- Print: `Tapped: conn_a1b2c3d4 (mqtt → broker.emqx.io/sensors/#)`
- Flags: `--name "My MQTT Feed"`, `--sample 30s`

**`livetap untap <connectionId>`** — `src/cli/untap.ts`:
- DELETE `http://localhost:{port}/connections/{connectionId}`
- Print: `Untapped: conn_a1b2c3d4`
- If connection has watchers: warn `This will also stop 2 watchers. Continue? (y/n)`

**`livetap taps`** — `src/cli/taps.ts`:
- GET `http://localhost:{port}/connections`
- Table output (same format as `status` but taps only)
- Flags: `--json` for raw JSON output

**`livetap sip <connectionId>`** — `src/cli/sip.ts`:
- GET `http://localhost:{port}/read_stream?connectionId={id}&backfillSeconds=60&maxEntries=10`
- Pretty-print entries with timestamps:
```
[10:00:01] topic=sensors/zone-a/telemetry
           temperature=21.4°C humidity=50% smoke=0.007ppm

[10:00:04] topic=sensors/zone-b/telemetry
           temperature=19.4°C humidity=74.2% smoke=0.012ppm
```
- If payload is JSON, auto-format key fields. If raw text, print as-is.
- Flags: `--live 10` (stream for 10 seconds using SSE), `--raw` (print raw JSON), `--max 50`

**`livetap watch <connectionId> <expression>`** — `src/cli/watch.ts`:
- Parse simple expression syntax from CLI args:
  - `livetap watch conn_abc "temperature > 50"` → single condition
  - `livetap watch conn_abc "temperature > 50 AND humidity > 90"` → multiple AND
  - `livetap watch conn_abc "temperature > 50 OR smoke > 0.05"` → multiple OR
- Expression parser: split on ` AND ` / ` OR `, each part is `field op value`
- POST to `http://localhost:{port}/watchers`
- Print: `Watcher created: w_1a2b3c4d (sensors.temperature.value > 50, cooldown 60s)`
- Flags: `--cooldown 30`, `--action webhook:https://...`, `--action shell:"echo alert"`, `--name "Temp Alert"`

**`livetap unwatch <watcherId>`** — `src/cli/unwatch.ts`:
- DELETE `http://localhost:{port}/watchers/{watcherId}`
- Print: `Watcher stopped: w_1a2b3c4d`

**`livetap watchers [connectionId]`** — `src/cli/watchers.ts`:
- GET `http://localhost:{port}/watchers?connectionId={id}` (or all if no ID)
- Table output:
```
Watchers for conn_a1b2c3d4:
  w_1a2b3c4d  sensors.temperature.value > 50  running  3 matches  cooldown 60s  last: 2m ago
  w_5e6f7a8b  humidity > 90 AND temp > 30     running  0 matches  cooldown 60s
```
- Flags: `--json`, `--logs <watcherId>` (shortcut for get_watcher_logs)

**`livetap help`** — `src/cli/help.ts`:
```
livetap — Push live data streams into your AI coding agent

Usage:
  livetap start                              Start the livetap daemon
  livetap stop                               Stop the daemon
  livetap status                             Show daemon, taps, and watchers

  livetap tap <uri|file.json>                Tap into a data source
  livetap tap mqtt://host/topic/#            Quick MQTT tap
  livetap tap wss://host/path                Quick WebSocket tap
  livetap tap webhook                        Create webhook ingest endpoint
  livetap untap <connectionId>               Remove a tap

  livetap taps                               List active taps
  livetap sip <connectionId>                 Sip from a stream (sample recent entries)

  livetap watch <connId> "field > value"     Create a watcher
  livetap unwatch <watcherId>                Remove a watcher
  livetap watchers [connectionId]            List watchers

Options:
  --port <n>        Daemon port (default 8788, env: LIVETAP_PORT)
  --foreground      Run daemon in foreground (start only)
  --json            Output as JSON (taps, watchers, sip)
  --help, -h        Show this help
```

**Daemon communication:**
All CLI commands talk to the daemon via HTTP on the port from `~/.livetap/state.json`. If the daemon isn't running:
- `start`: starts it
- All other commands: print `livetap is not running. Use 'livetap start' first.` and exit 1

**Tests:**
```
tests/phase4/
├── cli-start-stop.test.ts     # Start daemon via CLI → verify state.json written → verify :port responds → stop → verify port free + state.json removed
├── cli-start-already.test.ts  # Start when already running → verify "already running" message, no second daemon
├── cli-tap-mqtt.test.ts   # livetap tap mqtt://broker.emqx.io:1883/sensors/# → verify connection on daemon
├── cli-tap-ws.test.ts     # livetap tap wss://localhost:{ws-fixture-port} → verify connection on daemon
├── cli-tap-webhook.test.ts# livetap tap webhook → verify ingest URL printed → POST to it → verify in Redis
├── cli-tap-json.test.ts   # livetap tap tests/fixtures/connection.json → verify parsed correctly
├── cli-status.test.ts         # Start + create connection → livetap status → verify output includes connection info
├── cli-sip.test.ts            # Create webhook tap → push data → livetap sip <id> → verify entries printed
├── cli-watch-unwatch.test.ts  # livetap watch conn "temp > 50" → verify watcher created → livetap unwatch → verify removed
├── cli-watchers.test.ts       # Create watchers → livetap watchers → verify table output
├── cli-help.test.ts           # livetap help → verify output contains all commands
└── cli-not-running.test.ts    # Stop daemon → run any command → verify "not running" message
```

**Test fixture** — `tests/fixtures/connection.json`:
```json
{
  "type": "mqtt",
  "broker": "broker.emqx.io",
  "port": 1883,
  "tls": false,
  "topics": ["justinx/demo/#"],
  "credentials": { "username": "", "password": "" }
}
```

**Done gate:**
- `bun test tests/phase4/` passes (~12 tests)
- Manual end-to-end from terminal only (no Claude Code):
  ```bash
  livetap start
  livetap tap mqtt://broker.emqx.io:1883/justinx/demo/#
  livetap taps
  livetap sip conn_xxx
  livetap watch conn_xxx "sensors.temperature.value > 20"
  livetap watchers
  # wait for match...
  livetap watchers --logs w_xxx
  livetap unwatch w_xxx
  livetap untap conn_xxx
  livetap stop
  ```

---

### Phase 5: npm packaging + install flow

**Goal:** `npm install livetap` or `bun add livetap` works end-to-end. Postinstall auto-configures .mcp.json. Package published to npm as `@livetap`. A fresh user goes from zero to live data in Claude Code in under 2 minutes.

**Build:**

**package.json** — final shape:
```json
{
  "name": "@livetap",
  "version": "0.1.0",
  "description": "Push live data streams into your AI coding agent. Connect MQTT, Kafka, or webhooks.",
  "type": "module",
  "bin": {
    "livetap": "./bin/livetap.ts"
  },
  "scripts": {
    "postinstall": "bun ./scripts/postinstall.ts",
    "test": "bun test"
  },
  "keywords": [
    "mqtt", "kafka", "websocket", "webhook", "streaming",
    "real-time", "monitoring", "alerts", "mcp", "claude-code",
    "ai-agent", "iot", "observability", "data-pipeline"
  ],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/livetap/livetap"
  },
  "homepage": "https://github.com/livetap/livetap",
  "engines": {
    "bun": ">=1.0.0"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.28.0",
    "mqtt": "^5.15.0",
    "redis-server": "^1.2.0"
  },
  "devDependencies": {
    "@types/bun": "latest"
  },
  "files": [
    "bin/",
    "src/",
    "scripts/postinstall.ts",
    "README.md",
    "LICENSE"
  ]
}
```

Key decisions:
- `"bin": { "livetap": "./bin/livetap.ts" }` — Bun runs .ts directly, no build step needed
- `"files"` array controls what goes into the npm tarball — no tests, no docs, no .local
- `"engines": { "bun": ">=1.0.0" }` — documents the requirement (npm doesn't enforce it, but signals clearly)
- No `"main"` or `"module"` — this is a CLI tool, not a library

**Postinstall** — `scripts/postinstall.ts`:

Runs after `npm install livetap` or `bun add livetap`. Writes the .mcp.json entry and prints setup instructions.

```typescript
#!/usr/bin/env bun
import { existsSync } from 'fs'
import { resolve, dirname } from 'path'

const MCP_ENTRY = {
  livetap: {
    command: 'bunx',
    args: ['@livetap', 'mcp']    // starts the MCP channel proxy
  }
}

// Find project root (walk up from node_modules/@livetap to find .mcp.json location)
function findProjectRoot(): string {
  let dir = resolve(import.meta.dir, '..', '..', '..')  // up from node_modules/@livetap/scripts
  // Fallback: if we can't determine, use cwd
  if (!existsSync(resolve(dir, 'package.json'))) dir = process.cwd()
  return dir
}

function run() {
  // Skip in CI or when LIVETAP_SKIP_POSTINSTALL is set
  if (process.env.CI || process.env.LIVETAP_SKIP_POSTINSTALL) return

  const root = findProjectRoot()
  const mcpPath = resolve(root, '.mcp.json')

  let config: any = {}
  if (existsSync(mcpPath)) {
    try {
      config = JSON.parse(Bun.file(mcpPath).text())
    } catch {
      // malformed .mcp.json — don't clobber, warn instead
      console.warn('\n⚠ .mcp.json exists but is malformed. Skipping auto-config.')
      console.warn('  Add the livetap entry manually (see below).\n')
      printManualInstructions()
      return
    }
  }

  // Don't overwrite if livetap entry already exists
  if (config.mcpServers?.livetap) {
    console.log('\n✓ livetap already configured in .mcp.json\n')
    printRestartInstructions()
    return
  }

  // Add livetap entry
  config.mcpServers = { ...config.mcpServers, ...MCP_ENTRY }
  Bun.write(mcpPath, JSON.stringify(config, null, 2) + '\n')

  console.log('\n✓ livetap added to .mcp.json\n')
  printRestartInstructions()
}

function printRestartInstructions() {
  console.log('  To enable live data streaming in Claude Code, restart with:\n')
  console.log('    claude --dangerously-load-development-channels server:livetap\n')
  console.log('  Then ask Claude: "Connect to mqtt://broker.emqx.io:1883/sensors/#"\n')
}

function printManualInstructions() {
  console.log('  Add to .mcp.json:\n')
  console.log(`    ${JSON.stringify({ mcpServers: MCP_ENTRY }, null, 2)}\n`)
}

run()
```

Safety measures:
- **Never clobbers** existing .mcp.json — reads, merges, writes
- **Skips if livetap already present** — idempotent
- **Skips in CI** — `CI` env var or `LIVETAP_SKIP_POSTINSTALL`
- **Handles malformed .mcp.json** — warns, prints manual instructions, doesn't crash
- **Finds project root** — walks up from `node_modules` to find the right `.mcp.json` location

**`livetap mcp` subcommand** — the MCP entry point:

The postinstall writes `"args": ["@livetap", "mcp"]` which runs `livetap mcp`. This is the thin MCP channel proxy from Phase 2 — started as a subprocess by Claude Code via .mcp.json.

Add to `bin/livetap.ts`:
```typescript
mcp: () => import('../src/mcp/channel.js').then(m => m.run(args)),
```

This keeps the MCP entry point as part of the same binary — no separate file to find/resolve.

**`.npmignore`** (belt and suspenders with `"files"` in package.json):
```
.local/
.cursor/
tests/
docs/
scripts/mqtt-bridge.ts
scripts/livetap-channel.ts
.mcp.json
*.test.ts
```

**LICENSE** — MIT:
```
MIT License

Copyright (c) 2026 livetap contributors

Permission is hereby granted, free of charge, to any person obtaining a copy...
```

**Pre-publish checklist** (automated in a `scripts/prepublish.ts`):
```typescript
// Run before npm publish
// 1. Verify all tests pass
// 2. Verify bin/livetap.ts has shebang
// 3. Verify package.json has correct name, version, bin
// 4. Verify README exists and is non-empty
// 5. Verify LICENSE exists
// 6. Dry run: npm pack --dry-run, verify file list
```

**Install flow — what happens step by step:**

```bash
# User in their project directory:
bun add @livetap          # or: npm install @livetap

# 1. Bun/npm downloads and installs @livetap + deps (mqtt, redis-server, MCP SDK)
# 2. postinstall.ts runs:
#    - Finds .mcp.json (creates if missing)
#    - Adds livetap MCP server entry: { command: "bunx", args: ["@livetap", "mcp"] }
#    - Prints:
#
#    ✓ livetap added to .mcp.json
#
#      To enable live data streaming in Claude Code, restart with:
#
#        claude --dangerously-load-development-channels server:livetap
#
#      Then ask Claude: "Connect to mqtt://broker.emqx.io:1883/sensors/#"

# 3. User restarts Claude Code:
claude --dangerously-load-development-channels server:livetap

# 4. Claude Code reads .mcp.json, spawns `bunx @livetap mcp`
#    → MCP proxy starts, auto-starts daemon if needed
#    → Channel registered, tools available
#    → User talks to agent: "tap into my MQTT stream..."
```

**Global install also works:**
```bash
bun install -g @livetap    # installs `livetap` binary globally
livetap start              # start daemon from any directory
livetap tap mqtt://broker.emqx.io:1883/sensors/#
```
When installed globally, postinstall writes to `~/.mcp.json` (user-level MCP config) instead of project-level.

**Tests:**
```
tests/phase5/
├── postinstall-fresh.test.ts     # No .mcp.json exists → postinstall creates it with livetap entry
├── postinstall-existing.test.ts  # .mcp.json has other servers → livetap added without clobbering others
├── postinstall-already.test.ts   # .mcp.json already has livetap → no duplicate, prints "already configured"
├── postinstall-malformed.test.ts # .mcp.json contains invalid JSON → warns, prints manual instructions, doesn't crash
├── postinstall-ci-skip.test.ts   # CI=true → postinstall exits silently without writing
├── package-contents.test.ts      # npm pack → verify tarball contains bin/, src/, README, LICENSE — no tests/docs/.local
├── binary-smoke.test.ts          # Install tarball in temp dir → verify `livetap --help` works → verify `livetap --llm-help` outputs valid JSON
└── mcp-entry.test.ts             # Verify `livetap mcp` starts MCP server on stdio (connect with MCP client, call list_connections)
```

**Done gate:**
- `bun test tests/phase5/` passes (~8 tests)
- Manual — full clean-room test:
  ```bash
  # Build tarball
  cd livetap && npm pack

  # Fresh directory
  mkdir /tmp/livetap-test && cd /tmp/livetap-test
  bun init -y
  bun add /path/to/livetap-0.1.0.tgz

  # Verify postinstall
  cat .mcp.json   # should have livetap entry

  # Verify binary
  bunx @livetap --help
  bunx @livetap --llm-help | head

  # Verify MCP entry point
  bunx @livetap start
  bunx @livetap status
  bunx @livetap tap mqtt://broker.emqx.io:1883/justinx/demo/#
  bunx @livetap sip <conn_id>
  bunx @livetap stop

  # Clean up
  rm -rf /tmp/livetap-test
  ```

---

### Phase 6: WebSocket source protocol — hardening

**Goal:** Production-ready WebSocket source subscriber. Phase 1 scaffolds the basic WS client; this phase adds reconnection, auth headers, binary frame handling, connection state tracking, and tests against real-world WS patterns (financial feeds, streaming APIs).

**Why a separate phase:**
WebSocket sources have failure modes that MQTT and webhooks don't:
- Servers drop connections silently (no close frame)
- Auth via headers or initial handshake message (not URL params)
- Binary frames (protobuf, msgpack) alongside JSON
- Rate limiting / backpressure from the server
- Ping/pong keepalive requirements

**Build:**

**WebSocket connection config** — extends `src/server/types.ts`:
```typescript
interface WebSocketConnectionConfig {
  type: 'websocket';
  url: string;                      // "wss://stream.example.com/prices"
  headers?: Record<string, string>; // Auth headers: { "Authorization": "Bearer ..." }
  handshake?: string;               // Initial message to send after connect (e.g. subscription JSON)
  reconnect?: {
    enabled: boolean;               // default true
    maxRetries: number;             // default Infinity (keep trying)
    initialDelayMs: number;         // default 1000
    maxDelayMs: number;             // default 30000
  };
  pingIntervalMs?: number;          // Send ping frames every N ms (default 30000, 0 to disable)
  binaryFormat?: 'json' | 'text' | 'base64';  // How to store binary frames (default: 'base64')
}
```

**WebSocket subscriber** — `src/server/connections/websocket.ts` (hardened):

```typescript
class WebSocketSubscriber implements Subscriber {
  private ws: WebSocket | null = null
  private retryCount = 0
  private retryTimer: Timer | null = null
  private pingTimer: Timer | null = null
  private status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error' = 'disconnected'

  async start() {
    this.connect()
  }

  private connect() {
    this.status = this.retryCount === 0 ? 'connecting' : 'reconnecting'

    this.ws = new WebSocket(this.config.url, {
      headers: this.config.headers,
    })

    this.ws.onopen = () => {
      this.status = 'connected'
      this.retryCount = 0

      // Send handshake message if configured (e.g. subscription request)
      if (this.config.handshake) {
        this.ws!.send(this.config.handshake)
      }

      // Start ping keepalive
      if (this.config.pingIntervalMs) {
        this.pingTimer = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.ping()
          }
        }, this.config.pingIntervalMs)
      }
    }

    this.ws.onmessage = async (event) => {
      const fields = this.parseMessage(event.data)
      await this.redis.xadd(this.streamKey, '*', ...Object.entries(fields).flat())
      // XTRIM retention
      const minId = Date.now() - this.retentionMs
      await this.redis.xtrim(this.streamKey, 'MINID', '~', minId.toString())
    }

    this.ws.onclose = (event) => {
      this.cleanup()
      if (this.config.reconnect?.enabled !== false) {
        this.scheduleReconnect()
      } else {
        this.status = 'disconnected'
      }
    }

    this.ws.onerror = (event) => {
      // onerror is always followed by onclose, so reconnect logic lives there
      this.status = 'error'
    }
  }

  private parseMessage(data: string | Buffer | ArrayBuffer): Record<string, string> {
    if (typeof data === 'string') {
      // Try JSON parse
      try {
        const parsed = JSON.parse(data)
        return { payload: JSON.stringify(parsed), format: 'json' }
      } catch {
        return { payload: data, format: 'text' }
      }
    }
    // Binary frame
    const buf = data instanceof ArrayBuffer ? Buffer.from(data) : data
    switch (this.config.binaryFormat) {
      case 'json':
        try { return { payload: JSON.parse(buf.toString()), format: 'json' } }
        catch { return { payload: buf.toString('base64'), format: 'base64' } }
      case 'text':
        return { payload: buf.toString('utf-8'), format: 'text' }
      default:
        return { payload: buf.toString('base64'), format: 'base64' }
    }
  }

  private scheduleReconnect() {
    const maxRetries = this.config.reconnect?.maxRetries ?? Infinity
    if (this.retryCount >= maxRetries) {
      this.status = 'error'
      return
    }

    // Exponential backoff with jitter
    const base = this.config.reconnect?.initialDelayMs ?? 1000
    const max = this.config.reconnect?.maxDelayMs ?? 30000
    const delay = Math.min(base * Math.pow(2, this.retryCount), max)
    const jitter = delay * 0.2 * Math.random()  // ±20% jitter

    this.retryCount++
    this.status = 'reconnecting'
    this.retryTimer = setTimeout(() => this.connect(), delay + jitter)
  }

  private cleanup() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null }
  }

  async stop() {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null }
    this.cleanup()
    if (this.ws) { this.ws.close(); this.ws = null }
    this.status = 'disconnected'
  }

  getStatus() {
    return {
      status: this.status,
      retryCount: this.retryCount,
      url: this.config.url,
    }
  }
}
```

**Key behaviors:**
- **Reconnect with exponential backoff + jitter** — 1s → 2s → 4s → ... → 30s cap. Jitter prevents thundering herd if many connections drop at once.
- **Handshake message** — many WS APIs require sending a subscription message after connecting (e.g. `{"subscribe": "BTC-USD"}`). Configured via `handshake` field, sent on every (re)connect.
- **Ping keepalive** — some servers drop idle connections. Default 30s ping interval.
- **Binary frames** — stored as base64 by default. `binaryFormat: 'json'` attempts JSON parse first. `binaryFormat: 'text'` decodes as UTF-8.
- **Connection state** — `connecting`, `connected`, `reconnecting`, `disconnected`, `error`. Exposed via `get_connection` tool so agent can see if a WS source is flapping.

**Real-world WS patterns this handles:**

| Pattern | Example | How livetap handles it |
|---------|---------|----------------------|
| JSON stream | Crypto price feed | Parse JSON, store in Redis as `{payload: "{...}", format: "json"}` |
| Subscribe-on-connect | Binance WS: send `{"method":"SUBSCRIBE","params":["btcusdt@trade"]}` | `handshake` config field |
| Auth via header | Private API: `Authorization: Bearer xxx` | `headers` config field |
| Binary protobuf | gRPC-web, some finance feeds | Store as base64, decode later |
| Silent drops | Server crashes, no close frame | `onclose` fires → reconnect with backoff |
| Ping required | Server sends ping, expects pong | Bun WebSocket auto-responds to pings. livetap also sends pings proactively. |
| Rate limit | Server sends close code 1008 | Reconnect with backoff respects the delay |

**Update command catalog** — add to `src/shared/command-catalog.ts`:
```typescript
{
  name: 'create_connection',
  // ... extend examples:
  examples: [
    // ...existing mqtt, webhook...
    {
      description: 'Connect to a WebSocket stream',
      cli: 'livetap tap wss://stream.example.com/prices',
      tool: '{ type: "websocket", url: "wss://stream.example.com/prices" }'
    },
    {
      description: 'Connect to WebSocket with auth and subscription',
      tool: '{ type: "websocket", url: "wss://api.example.com/ws", headers: {"Authorization": "Bearer xxx"}, handshake: "{\"subscribe\": \"BTC-USD\"}" }'
    }
  ]
}
```

**Tests:**
```
tests/phase6/
├── ws-basic.test.ts           # Fixture WS server sends JSON → create_connection → verify entries in Redis with format=json
├── ws-text.test.ts            # Fixture WS server sends plain text → verify stored with format=text
├── ws-binary.test.ts          # Fixture WS server sends Buffer → verify stored as base64
├── ws-binary-json.test.ts     # binaryFormat='json' + fixture sends JSON as Buffer → verify parsed as JSON
├── ws-reconnect.test.ts       # Fixture drops connection after 3 messages → verify client reconnects → new messages arrive
├── ws-reconnect-backoff.test.ts # Fixture rejects 3 connections then accepts → verify delays increase (1s, 2s, 4s)
├── ws-reconnect-max.test.ts   # maxRetries=2, fixture always drops → verify status becomes 'error' after 2 retries
├── ws-handshake.test.ts       # Fixture expects subscription message on connect → verify handshake sent → messages flow
├── ws-headers.test.ts         # Fixture checks Authorization header → create_connection with headers → verify connected
├── ws-ping.test.ts            # Fixture requires ping within 5s or drops → pingIntervalMs=2000 → verify stays connected
├── ws-retention.test.ts       # Push many messages → verify XTRIM keeps only retention window
└── ws-status.test.ts          # Connect → verify status='connected'. Drop → verify status='reconnecting'. Stop → 'disconnected'.
```

**Simulated WS server fixture** — `tests/fixtures/ws-server.ts` (enhanced from Phase 1):

```typescript
interface WsServerOptions {
  intervalMs?: number           // Send interval (default 500ms)
  requireAuth?: string          // Reject if Authorization header !== this
  requireHandshake?: string     // Wait for this message before sending data
  dropAfter?: number            // Drop connection after N messages
  rejectConnections?: number    // Reject first N connection attempts
  requirePingWithinMs?: number  // Drop if no ping received within N ms
  sendBinary?: boolean          // Send binary frames instead of text
}

function createWsServer(opts: WsServerOptions = {}) {
  // Returns { start(): Promise<{port}>, stop(), dropConnection(), sentCount, connectionCount }
}
```

**Done gate:**
- `bun test tests/phase6/` passes (~12 tests)
- Manual — connect to a real public WebSocket feed:
  ```bash
  livetap start
  # Binance BTC trades (public, no auth)
  livetap tap 'wss://stream.binance.com:9443/ws/btcusdt@trade'
  livetap sip <conn_id>
  # Should see: {"e":"trade","s":"BTCUSDT","p":"67234.50",...}
  livetap watch <conn_id> "p > 70000"    # alert if BTC > $70k
  livetap stop
  ```

---

### Phase 7: Launch prep

**Goal:** Everything a stranger needs to go from "what is this?" to "wow, live data in my Claude Code session" in under 2 minutes. README, demo, HN post, npm publish, GitHub polish.

**No new code.** This phase is docs, marketing, and release engineering.

---

**README.md** — complete rewrite from current stub:

Structure:
```
# livetap
> Push live data streams into your AI coding agent.

## Demo (GIF or asciinema embed)

## Quick start (30 seconds)
  bun add @livetap
  # restart Claude Code with channels
  # "hey Claude, connect to mqtt://broker.emqx.io:1883/sensors/#"

## What it does (2 paragraphs + diagram)

## Supported sources
  - MQTT
  - WebSocket
  - Webhooks
  - Kafka (coming in v0.2)

## How it works (architecture diagram — text art, not an image)

## CLI reference (generated from command catalog)

## MCP tools (generated from command catalog)

## Agent instructions
  How your AI agent uses livetap — the workflow it follows

## Examples
  - IoT sensor monitoring
  - Crypto price alerts
  - CI/CD webhook watcher
  - Custom WebSocket feed

## Configuration
  - ~/.livetap/ directory
  - .mcp.json setup
  - Environment variables (LIVETAP_PORT, etc.)

## Cloud upgrade → JustinX
  One paragraph + link. Not salesy.

## Contributing

## License — MIT
```

Key principles:
- **GIF/demo first** — before any text. Show don't tell.
- **30-second quick start** — 3 commands max to see live data in Claude Code
- **CLI and MCP docs auto-generated** from command catalog (Phase 4 shared foundation) — run `bun scripts/generate-docs.ts` to update README sections. Never hand-edit these sections.
- **Examples are real** — each one should be copy-pasteable and work

**`scripts/generate-docs.ts`** — reads command catalog, generates:
- CLI reference section (markdown table from `COMMAND_CATALOG.daemon` + `COMMAND_CATALOG.tools`)
- MCP tools section (from tool schemas)
- Writes to tagged sections in README.md between `<!-- BEGIN:CLI -->` and `<!-- END:CLI -->` markers

---

**Demo recording** — terminal screencast showing the full user story:

Script (target: 90 seconds):
```
1. [0:00]  Title card: "livetap — live data in your AI agent"
2. [0:05]  Terminal: bun add @livetap (show postinstall output)
3. [0:15]  Terminal: claude --dangerously-load-development-channels server:livetap
4. [0:20]  Claude Code: "Connect to the IoT demo at mqtt://broker.emqx.io:1883/justinx/demo/#"
5. [0:30]  Claude: calls create_connection, shows "Connected: conn_xxx"
6. [0:35]  Claude: "Sample the stream for me"
7. [0:40]  Claude: calls read_stream, shows sensor data (temp, humidity, air quality)
8. [0:50]  Claude: "Watch zone-a for temperature above 25°C and log alerts to alerts.txt"
9. [0:55]  Claude: calls create_watcher, shows "Watcher created: w_xxx"
10. [1:05] Channel alert arrives: ← livetap: temperature=25.4°C > 25°C
11. [1:10] Claude: reads alert, appends summary line to alerts.txt
12. [1:15] Claude: "Alert logged. sensor-zone-a hit 25.4°C at 10:05:08Z"
13. [1:20] Show alerts.txt with the line
14. [1:25] End card: "npm install @livetap — github.com/livetap/livetap"
```

Recording tool: [asciinema](https://asciinema.org/) for terminal embed, or screen recording for GIF.
- Asciinema: embed in README with `[![asciicast](https://asciinema.org/a/xxx.svg)](https://asciinema.org/a/xxx)`
- GIF: for GitHub README preview (people scroll past SVGs). Keep under 5MB. Use [vhs](https://github.com/charmbracelet/vhs) or `agg` to convert asciinema to GIF.

---

**HN Show HN post:**

Title:
> Show HN: livetap – Push live MQTT/WebSocket/webhook streams into Claude Code

Post body (must be concise — HN readers skim):
```
livetap pushes live data streams into your AI coding agent's session.

Connect an MQTT broker, WebSocket feed, or webhook endpoint.
Your agent samples the data, sets up expression-based watchers,
and acts on alerts — all through natural language.

  bun add @livetap
  claude --dangerously-load-development-channels server:livetap
  "Connect to mqtt://broker.emqx.io:1883/sensors/#"

How it works:
- livetap daemon manages connections + embedded Redis
- Thin MCP channel proxy pushes events into Claude Code
- Agent creates watchers like "alert when temp > 50"
- When conditions match, alert arrives as a <channel> tag
- Agent acts: logs to file, calls APIs, whatever tools it has

Built with Bun. MIT licensed. No cloud required.

Demo: [link to asciinema or GIF]
GitHub: https://github.com/livetap/livetap
npm: https://www.npmjs.com/package/@livetap

We built this because existing streaming tools (Grafana, Datadog)
aren't accessible from AI coding agents. livetap bridges that gap
using Claude Code's Channels research preview.

Supported sources: MQTT, WebSocket, Webhooks. Kafka coming next.

Happy to answer questions about the architecture, Channels API,
or the expression watcher design.
```

**HN timing:** Post Tuesday-Thursday, 8-10am EST (peak HN traffic). Avoid Mondays (busy) and Fridays (low engagement).

---

**npm publish:**

```bash
# Pre-publish checks (automated via scripts/prepublish.ts):
bun test                           # All phases pass
bun scripts/generate-docs.ts       # README sections up to date
npm pack --dry-run                 # Verify file list

# Publish:
npm publish --access public        # @livetap is a scoped package, needs --access public

# Verify:
mkdir /tmp/verify && cd /tmp/verify
bun init -y && bun add @livetap
cat .mcp.json                      # should have livetap entry
bunx @livetap --help               # should print help
rm -rf /tmp/verify
```

**npm README:** npm shows the README from the package. Since we auto-generate CLI/MCP sections, run `generate-docs.ts` before every publish.

**Version strategy:**
- `0.1.0` — launch (phases 1-7)
- `0.1.x` — patch fixes from user feedback
- `0.2.0` — Kafka support, config persistence (v0.1 roadmap items)
- `1.0.0` — stable API, Codex support, after community validation

---

**GitHub repo polish:**

- **Description:** "Push live data streams into your AI coding agent"
- **Topics:** `mqtt`, `kafka`, `websocket`, `mcp`, `claude-code`, `streaming`, `real-time`, `ai-agent`
- **Website:** link to npm package or a landing page
- **License:** MIT (add LICENSE file)
- **Branch protection:** `main` requires PR, `v0` is development branch
- **Issue templates:**
  - Bug report (connection type, OS, Bun version, steps to reproduce)
  - Feature request (protocol, use case)
- **CONTRIBUTING.md:**
  ```
  # Contributing to livetap

  ## Setup
  git clone https://github.com/livetap/livetap && cd livetap
  git checkout v0
  bun install
  bun test

  ## Architecture
  See docs/PLAN.md for the full build plan and phase breakdown.

  ## Adding a new protocol
  1. Add connection config type to src/server/types.ts
  2. Create subscriber in src/server/connections/
  3. Add to command catalog in src/shared/command-catalog.ts
  4. Add tests in tests/

  ## Running tests
  bun test                    # all tests
  bun test tests/phase1/      # specific phase
  SKIP_LIVE_MQTT=1 bun test   # skip tests requiring broker.emqx.io
  ```

---

**Launch day checklist:**

Pre-launch (day before):
- [ ] All `bun test` pass (phases 1-6, ~60 tests)
- [ ] `npm pack` → clean install in fresh dir → full flow works
- [ ] README has working quick start (tested from scratch)
- [ ] Demo GIF/asciinema recorded and embedded in README
- [ ] HN post drafted and reviewed
- [ ] CONTRIBUTING.md written
- [ ] LICENSE file added (MIT)
- [ ] GitHub repo topics and description set
- [ ] Issue templates added

Launch (morning, Tue-Thu 8-10am EST):
- [ ] `npm publish --access public`
- [ ] Verify: `bun add @livetap` works from fresh project
- [ ] Merge `v0` → `main` (or keep as default branch)
- [ ] Make GitHub repo public (if not already)
- [ ] Post to HN
- [ ] Post to relevant subreddits: r/programming, r/IoT, r/homeautomation, r/ClaudeAI
- [ ] Tweet/X post with demo GIF

Post-launch (first 48 hours):
- [ ] Monitor HN comments — respond to technical questions
- [ ] Monitor GitHub issues — fast response to install/setup problems
- [ ] Fix any "it doesn't work on my machine" issues immediately
- [ ] Track npm download count
- [ ] Note feature requests for v0.2 roadmap

---

**Done gate:**
- All items in launch day checklist completed
- npm package live and installable
- At least one person outside the team has completed the full flow (install → connect → sample → watch → alert)

---

## Architecture

### Process Model

```
livetap start (background daemon on :8788)
  ├── redis-server (child process, auto-managed)
  ├── Connection Manager
  │     ├── MQTT subscribers
  │     ├── WebSocket subscribers
  │     ├── Webhook ingestors
  │     └── Kafka consumers (v1)
  ├── Watcher Engine (expression evaluator)
  │     └── evaluates conditions against stream entries
  └── HTTP API (:8788)
        ├── MCP tool endpoints (create_connection, read_stream, etc.)
        ├── SSE /events endpoint (watcher alerts)
        └── channel event push endpoint

Claude Code
  └── livetap-channel (thin MCP stdio proxy)
        ├── connects to daemon at localhost:8788
        ├── exposes MCP tools (proxied to daemon)
        ├── holds SSE connection for alerts
        └── pushes channel notifications into session
```

### Data Flow

```
Source (MQTT/WS/Webhook) ──→ Subscriber ──→ Redis Stream ──→ Watcher Engine
                                                 │                  │
                                                 ▼                  ▼ (on match)
                                            read_stream tool    SSE /events
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
livetap start                    # Start daemon (Redis + API on :8788)
livetap stop                     # Stop daemon
livetap status                   # Show daemon status, connections, watchers

# Connections
livetap tap mqtt://broker.emqx.io/sensors/#       # Quick URI
livetap tap connection.json                         # Full config
livetap taps                                     # List
livetap untap <connectionId>                       # Remove

# Watchers
livetap watch <connectionId> --field temp --op gt --value 50
livetap watchers <connectionId>
livetap unwatch <connectionId> <watcherId>

# Sampling
livetap sip <connectionId>                              # Sip from stream (sample recent entries)
livetap sip <connectionId> --live 10                    # Stream for 10s
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
#    - If not, starts it in background (livetap start)
#    - Connects and proxies MCP tools + channel events
```

## File Structure

```
@livetap/
├── bin/
│   └── livetap.ts              # CLI entry point
├── src/
│   ├── shared/
│   │   ├── command-catalog.ts     # Single source of truth for tools + CLI commands
│   │   └── catalog-generators.ts  # Generates: MCP instructions, --help, --llm-help
│   ├── server/
│   │   ├── index.ts            # Daemon entry (Bun.serve on :8788)
│   │   ├── redis.ts            # Embedded redis-server lifecycle
│   │   ├── connection-manager.ts
│   │   ├── connections/
│   │   │   ├── mqtt.ts
│   │   │   ├── webhook.ts
│   │   │   ├── websocket.ts
│   │   │   └── kafka.ts        # v1
│   │   └── watchers/
│   │       ├── engine.ts       # Expression evaluator
│   │       └── types.ts
│   ├── mcp/
│   │   ├── channel.ts          # Thin MCP stdio proxy (channel + tools)
│   │   └── tools.ts            # Tool definitions (mirroring JustinX)
│   └── cli/
│       ├── start.ts
│       ├── stop.ts
│       ├── status.ts
│       ├── tap.ts
│       ├── untap.ts
│       ├── taps.ts
│       ├── sip.ts
│       ├── watch.ts
│       ├── unwatch.ts
│       ├── watchers.ts
│       └── help.ts
├── package.json
├── tsconfig.json
└── livetap.json                # Optional config file (v0.1)
```

## Protocols

### v0 (Launch)
- **MQTT** — tested, proven with broker.emqx.io demo
- **Webhooks** — HTTP ingest endpoint, simple
- **WebSocket (source)** — connects to remote WS, each message → Redis. Unlocks finance, blockchain segments.

### v1
- **Kafka** — consumer group, SASL auth

### Future
- **SSE** — CI/CD events
- **gRPC streams** — blockchain, DevOps

## Testing Strategy

All tests run with `bun test`. No external dependencies except broker.emqx.io for live MQTT tests (skippable via `SKIP_LIVE_MQTT=1`).

### Test infrastructure
- **Embedded Redis** — each test suite boots its own Redis on a random port, tears down after
- **Simulated senders** — reusable fixtures in `tests/fixtures/`:
  - `webhook-sender.ts` — HTTP server that POSTs JSON payloads to a target URL on interval
  - `ws-server.ts` — WebSocket server that sends JSON messages on interval, supports drop/reconnect
  - `mqtt-publisher.ts` — publishes to broker.emqx.io temp topic (or skipped)
- **Test data** — `tests/fixtures/payloads/` with sample MQTT, webhook, and WS JSON payloads

### Test commands
```bash
bun test                       # All tests
bun test tests/phase1/         # Phase 1 only
bun test --watch               # Watch mode during development
SKIP_LIVE_MQTT=1 bun test      # Skip tests that need broker.emqx.io
```

### Per-phase test count targets
| Phase | Unit | Integration | Total |
|-------|------|-------------|-------|
| 1 | 6 | 4 | ~10 |
| 2 | 3 | 3 | ~6 |
| 3 | 5 | 4 | ~9 |
| 4 | 4 | 2 | ~6 |
| 5 | 3 | 1 | ~4 |
| 6 | 3 | 2 | ~5 |
| **Total** | **24** | **16** | **~40** |

## v0.1 Additions
- JSON config file persistence (livetap.json)
- `livetap export` / `livetap import`
- Per-protocol smart sampling defaults
- `livetap init` wizard
- Kafka protocol support

## Launch

### HN Title
> Show HN: livetap – Push live MQTT/Kafka/webhook streams into Claude Code

### npm Description
> Push live data streams into your AI coding agent. Connect MQTT, Kafka, or webhooks. Your agent samples, watches, and acts on real-time data through natural language.

### npm Keywords
mqtt, kafka, websocket, webhook, streaming, real-time, monitoring, alerts, mcp, claude-code, ai-agent, iot, observability, data-pipeline
