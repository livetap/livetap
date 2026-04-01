# LiveTap v0.2 Plan

> Previous plan: [PLAN.0.1.5.md](./PLAN.0.1.5.md)

## Goal

Seamless first-run experience. `npm install livetap` → `npx livetap setup` → restart Claude Code → everything works. No external dependencies. No "Unable to connect" errors. Ever.

---

## Phase 0: Drop Redis, Replace with In-Memory StreamStore

### Why

The `redis-server` npm package does NOT bundle a Redis binary — it's just a wrapper that spawns whatever `redis-server` is on PATH. This means `npm install livetap` doesn't actually give you a working system. Users need `brew install redis` separately, which breaks the zero-config install goal.

Redis is massively overkill for our use case. We use 6 commands out of 400+. No persistence, no pub/sub, no transactions, no multi-process sharing. Everything runs in a single daemon process.

### What Redis does today (complete inventory)

| Feature | Call Sites | What It Does |
|---------|-----------|-------------|
| XADD | 4 (mqtt, ws, file, webhook subscribers) | Append entry to stream with timestamp ID |
| XTRIM MINID | 4 (same subscribers) | Rolling retention — delete entries older than 5 min |
| XREAD BLOCK | 1 (watchers/manager.ts) | Watcher polls for new entries — each watcher spawns a separate ioredis connection |
| XRANGE | 1 (index.ts /stream endpoint) | Backfill read for read_stream API |
| XLEN | 1 (connection-manager.ts) | Get buffered entry count |
| HSET/HDEL | 3 (watchers/manager.ts) | Store/delete watcher definitions — **already redundant**, duplicated in in-memory Map |
| DEL | 1 (connection-manager.ts) | Delete stream on connection destroy |

### StreamStore design (~100 lines)

Replace `src/server/redis.ts` with `src/server/stream-store.ts`:

```ts
import { EventEmitter } from 'events'

interface StreamEntry {
  id: string          // "{timestamp}-{seq}" like Redis
  fields: Record<string, string>
}

class StreamStore {
  private streams = new Map<string, StreamEntry[]>()
  private seqCounters = new Map<string, number>()
  private emitter = new EventEmitter()

  // Replace XADD — append entry, emit event for watchers
  append(streamKey: string, fields: Record<string, string>): string

  // Replace XRANGE — filter by timestamp range
  range(streamKey: string, since: string, count?: number): StreamEntry[]

  // Replace XTRIM MINID — remove entries older than minTs
  trim(streamKey: string, minTs: number): void

  // Replace XLEN
  len(streamKey: string): number

  // Replace DEL
  del(streamKey: string): void

  // Replace XREAD BLOCK — EventEmitter subscription (zero-latency, better than 2s block)
  subscribe(streamKey: string, callback: (entry: StreamEntry) => void): () => void
}
```

**Key improvement:** Watchers currently spawn a **separate ioredis connection each** for XREAD BLOCK with 2s timeout. With EventEmitter, watchers get instant notification on new entries. Zero connections, zero latency.

### Files to change

| File | Change |
|------|--------|
| `src/server/redis.ts` | **Delete** |
| `src/server/stream-store.ts` | **New** (~100 lines) |
| `src/server/connections/mqtt.ts` | `redis.xadd()`/`xtrim()` → `store.append()`/`store.trim()` |
| `src/server/connections/websocket.ts` | Same |
| `src/server/connections/file.ts` | Same |
| `src/server/connections/webhook.ts` | Same |
| `src/server/connection-manager.ts` | `redis.xlen()`/`redis.del()` → `store.len()`/`store.del()` — remove redisUrl |
| `src/server/watchers/manager.ts` | XREAD BLOCK loop → `store.subscribe()` — remove per-watcher ioredis connections, remove redundant HSET/HDEL |
| `src/server/index.ts` | `startRedis()` → `new StreamStore()` — `xrange()` → `store.range()` |
| `src/cli/status.ts` | Remove "Redis: localhost:PORT" from status output |
| `package.json` | Remove `ioredis` and `redis-server` from dependencies |
| `tests/phase1/redis.test.ts` | **Delete** |
| `tests/phase1/ws-connection.test.ts` | Replace `startRedis()` + `xrange()` with store or HTTP API |
| `tests/phase1/webhook-connection.test.ts` | Same |
| `tests/phase6/ws-hardening.test.ts` | Same |
| `tests/phase-file/file-tail.test.ts` | Same |

**Total: 9 source files modified, 1 new, 1 deleted. 4 test files modified, 1 test deleted. 2 npm deps removed.**

### Phase 0F: Update all Redis references in docs and code

Dropping Redis changes the install requirements and architecture. These changes belong in THIS branch, not the separate docs PR.

| File | Refs | Change |
|------|------|--------|
| `README.md` | 4 | Remove "Redis (`brew install redis`)" from requirements. Update architecture diagram: "Redis Stream" → "StreamStore". Update "What it does" section: "embedded Redis" → "in-memory stream buffer". |
| `CONTRIBUTING.md` | 2 | Remove "Redis (`brew install redis`)" from requirements. |
| `CLAUDE.md` | 1 | Remove "Bun.redis for Redis. Don't use ioredis." — no longer relevant. |
| `src/cli/status.ts` | 1 | Remove Redis status line from output. |
| `src/cli/start.ts` | 1 | Remove Redis reference from startup messaging. |
| `src/shared/command-catalog.ts` | 1 | Remove Redis mention. |
| `src/mcp/tools.ts` | 1 | "Redis stream" → "stream" in description. |
| `memory/MEMORY.md` | multiple | Update project memory: remove Redis gotchas, update architecture, update requirements. |

**New install requirements:**

Before (v0.1.5):
```
Requirements: Bun, Redis (brew install redis), Claude Code v2.1.80+
```

After (v0.2):
```
Requirements: Bun, Claude Code v2.1.80+
```

`npm install livetap` is now fully self-contained. No system dependencies beyond Bun.

### What does NOT change

- MCP proxy (`channel.ts`, `tools.ts`) — talks HTTP to daemon, never touches Redis
- Watcher engine (`engine.ts`) — pure evaluation logic, no storage
- All CLI commands — talk HTTP to daemon
- MCP instructions, command catalog, --llm-help
- 8 test files with zero Redis involvement

---

## Phase 1: Bulletproof Daemon Lifecycle

### Problem

The install flow breaks on first interaction:
1. ~~MCP proxy auto-starts daemon with 10s timeout — too tight for Redis boot (5-8s)~~ Redis removed — but daemon still needs HTTP server to be ready
2. Tool proxy has zero retry logic — one failed fetch = immediate error to agent
3. Daemon spawned without `proc.unref()` — dies when parent exits
4. Daemon path is hardcoded relative (`src/server/index.ts`) — breaks for npm installs

### 1A. Start daemon during `npx livetap setup`

After writing `.mcp.json`, setup also boots the daemon:

```
npx livetap setup
  → writes .mcp.json
  → starts daemon via `livetap start` CLI
  → shows ASCII spinner with progressive status:
      Starting daemon... ✓
      Daemon ready on :8788
  → prints "Next: restart Claude Code with ..."
```

By the time the user restarts Claude Code, the daemon is already warm. With Redis removed, daemon startup is near-instant (just `Bun.serve()`).

### 1B. Single daemon start code path

All daemon starts go through `livetap start` CLI — no duplicate spawn logic:
- `npx livetap setup` → calls `livetap start`
- MCP proxy auto-start (`channel.ts`) → calls `npx livetap start`
- Tool proxy retry (`tools.ts`) → calls `npx livetap start`

This eliminates the hardcoded relative path problem (CLI knows how to find the daemon entry point) and ensures consistent behavior everywhere.

### 1C. Full daemonization

Use `Bun.spawn` + `proc.unref()` to detach the daemon from parent:

```ts
const proc = Bun.spawn(['bun', daemonEntryPoint], {
  stdout: Bun.file(logPath),
  stderr: Bun.file(logPath),
  stdin: 'ignore',
  env: { ...process.env, LIVETAP_PORT: String(port) },
})
proc.unref()
```

**PID file:** Write to `~/.livetap/daemon.pid` on start. Read on stop/status.

**Test plan:** Test `unref()` alone for terminal close survival. If SIGHUP kills the daemon, add `process.on('SIGHUP', () => {})` as belt-and-suspenders.

**Stale PID handling** (`livetap stop`):
1. Read PID from `~/.livetap/daemon.pid`
2. Check if process exists (`kill -0 <pid>`)
3. Also check if port :8788 is listening
4. If PID stale but port occupied → warn "port 8788 in use by another process"
5. If PID stale and port free → clean up PID file, print "daemon not running"

### 1D. MCP proxy auto-start fallback

Keep `autoStartDaemon()` in `channel.ts` as safety net for when daemon dies between sessions:

- Calls `npx livetap start` (not Bun.spawn directly)
- Increase timeout from 10s → 30s
- Add `proc.unref()` so proxy can exit cleanly

### 1E. Retry-in-tool-proxy

In `tools.ts`, when `fetch()` to daemon fails:

1. Attempt to start daemon via `npx livetap start`
2. Wait for daemon health (poll /status, up to 30s)
3. Retry the original fetch 2-3 times with 2s delay
4. **On success:** Include note in response: "Note: daemon was restarted before processing this request."
5. **On final failure:** "Daemon could not be started after 3 attempts. Run `livetap start` manually."

### 1F. Status MCP tool

Add `status` as 13th MCP tool, mirroring the CLI `livetap status` command:

```json
{
  "name": "status",
  "description": "Check daemon health and active resources",
  "inputSchema": {}
}
```

Returns: daemon up/down, uptime, port, active connection count, active watcher count, version.

Agent uses this for troubleshooting — not required on every session start.

### 1G. SSE auto-reconnect

Existing `connectToSSE()` in `channel.ts` already retries every 5s on failure. Verify this works correctly after a full daemon restart. If the SSE endpoint changes behavior on restart, handle reconnection gracefully.

### 1H. Update --llm-help instructions

Update setup steps to reflect new flow:
- Step 2 becomes: "npx livetap setup (creates .mcp.json AND starts daemon)"
- Keep restart command explicit: `claude --dangerously-load-development-channels server:livetap --continue`
- Add: "If a tool returns 'daemon was restarted', this is normal — the daemon auto-heals"

### 1I. Update command catalog

Add `status` to CLI_COMMANDS in `src/shared/command-catalog.ts`. Ensure MCP TOOLS array includes the new status tool. Update `generateInstructions()` to mention the status tool.

---

## Build Order

1. **Phase 0A:** Build `StreamStore` class with tests
2. **Phase 0B:** Replace Redis calls in subscribers (mqtt, ws, file, webhook)
3. **Phase 0C:** Replace Redis in connection-manager and watchers/manager
4. **Phase 0D:** Replace Redis in daemon index.ts, update tests, remove deps
5. **Phase 0E:** Run full test suite, verify everything passes
6. **Phase 0F:** Update all Redis references in docs (README, CONTRIBUTING, CLAUDE.md, CLI, MCP tools, memory)
7. **Phase 1A-1C:** Daemon lifecycle (setup starts daemon, daemonize, PID file)
8. **Phase 1D-1E:** MCP proxy fallback + tool retry
9. **Phase 1F-1I:** Status tool, SSE reconnect, update docs/catalog

---

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Redis replacement | In-memory StreamStore | redis-server npm doesn't bundle binary. Redis overkill for 6 commands. |
| Watcher notification | EventEmitter (replaces XREAD BLOCK) | Zero-latency vs 2s block. No per-watcher connections. |
| Daemon start timing | During setup | Daemon is warm before Claude restarts |
| Daemonization method | Bun.spawn + unref() | Native, no extra deps. Test SIGHUP survival. |
| PID file location | ~/.livetap/daemon.pid | Dedicated state dir, already used for logs |
| Start code path | All via CLI (`livetap start`) | Single source of truth, eliminates path bugs |
| MCP health tool | New `status` tool (13th) | Mirrors CLI, consistent naming |
| Tool retry feedback | Mention in response | Agent knows infrastructure hiccup occurred |
| State persistence | Not in v0.2 | Agent recreates connections. Persistence later. |
| Setup spinner | Simple ASCII (no deps) | setInterval + stdout.write, no dependency |
| Stale PID | Check port too | Catches "something else on :8788" edge case |
| Docs fixes | Separate PR | Independent of this work, cleaner review |
| SIGHUP guard | Test first | Try unref() alone, add guard only if needed |

---

## Out of Scope (future)

- Connection/watcher state persistence to disk (JSON file)
- In-process daemon (eliminate subprocess entirely)
- Webhook protocol (built, deferred)
- Kafka protocol
- Docker/exec schemes
- Log rotation for daemon logs

---

## Doc Fixes (Separate PR)

22 issues found in docs audit. Saved to `.local/docs-audit.md`.

**Fixed by this branch (not separate PR):**
- Issue 1/29: "brew install redis" in README/CONTRIBUTING → removed in Phase 0F
- Issue 10: ioredis contradicts CLAUDE.md → both removed in Phase 0F
- Issue 19: Daemon auto-start relative path → fixed by Phase 1B (all via CLI)

**Fixed by Phase 1 of this branch:**
- Issue 12: Version 0.1.4 hardcoded → read from package.json at runtime

**Remaining for separate PR (16 issues):**
- Issue 2: bun add vs npm install inconsistency
- Issue 3: Branch name references
- Issue 4: Webhooks status contradictions
- Issue 5: README .mcp.json example placeholder
- Issue 6-7: Missing CLI flags in README (--max, --back, --action)
- Issue 8: Mixed MQTT topics in examples
- Issue 9/30: Hardcoded test count "103"
- Issue 13: --json vs --raw for sip
- Issue 15: "Do NOT use npm init" possibly stale
- Issue 20: .mcp.json "run" arg inconsistency
- Issues 21-28: PLAN.0.1.5.md historical drift (low priority, archived)
- README drift-prone content: consider building `scripts/generate-docs.ts`
