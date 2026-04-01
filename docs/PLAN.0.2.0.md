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

### Target UX

**First install (agent steps):**
1. Agent runs `npm install livetap`
2. Agent runs `npx livetap setup` → writes .mcp.json → **starts daemon** → spinner → "Daemon ready on :8788"
3. Agent tells user to restart Claude Code
4. User restarts → MCP proxy boots → daemon already running → tools work immediately

**Resume after closing laptop / killing terminal / rebooting:**
1. Daemon survives parent exit (`unref()` + PID file)
2. User reopens Claude Code → MCP proxy boots → checks `/status` → daemon alive → tools work
3. If daemon died → MCP proxy calls `npx livetap start` → waits 30s → works
4. If that fails → tool proxy retries on first tool call, auto-starts daemon, mentions restart in response
5. Last resort → clear error: "Daemon could not be started. Run `livetap start` manually."

Multiple layers of self-healing. No single point of failure.

---

### 1A. Start daemon during `npx livetap setup`

After writing `.mcp.json`, setup also boots the daemon:

```
npx livetap setup
  → writes .mcp.json
  → starts daemon via `livetap start` CLI
  → shows ASCII spinner:
      Starting daemon... ✓
      Daemon ready on :8788
  → prints "Next: restart Claude Code with ..."
```

Daemon startup is near-instant (just `Bun.serve()`, no Redis). By the time user restarts Claude Code, daemon is warm.

### 1B. Single daemon start code path

All daemon starts go through `livetap start` CLI — no duplicate spawn logic:
- `npx livetap setup` → calls `livetap start`
- MCP proxy auto-start (`channel.ts`) → calls `npx livetap start`
- Tool proxy retry (`tools.ts`) → calls `npx livetap start`

This eliminates path bugs and ensures consistent behavior everywhere.

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

### 1E. Retry-in-tool-proxy

In `tools.ts`, when `fetch()` to daemon fails:

1. Attempt to start daemon via `npx livetap start`
2. Wait for daemon health (poll /status, up to 30s)
3. Retry the original fetch 2-3 times with 2s delay
4. **On success:** Include note in response: "Note: daemon was restarted before processing this request."
5. **On final failure:** "Daemon could not be started after 3 attempts. Run `livetap start` manually."

### 1F. Status MCP tool

Add `status` as 13th MCP tool, mirroring CLI `livetap status`:

Returns: daemon up/down, uptime, port, active connection count, active watcher count, version.

Agent uses this for troubleshooting — not required on every session start.

### 1G. SSE auto-reconnect

Existing `connectToSSE()` already retries every 5s. Verify it works after a full daemon restart.

### 1H. Update all docs, help, and instructions

Every user/agent-facing surface must reflect the new daemon lifecycle:

| File | What changes |
|------|-------------|
| `src/cli/setup.ts` | Add daemon start after writing .mcp.json, ASCII spinner, wait for healthy |
| `src/cli/start.ts` | Add `proc.unref()`, PID file write to `~/.livetap/daemon.pid`, stale PID check |
| `src/cli/stop.ts` | Read PID file, check port, handle stale PID with clear messages |
| `src/cli/status.ts` | Show PID info, handle daemon-down state |
| `src/mcp/channel.ts` | Auto-start via `npx livetap start` (not Bun.spawn), 30s timeout |
| `src/mcp/tools.ts` | Add retry-on-fail with daemon restart + `status` tool (13th) |
| `src/shared/command-catalog.ts` | Update `setup` description: "creates .mcp.json and starts daemon". Add `status` to MCP tools list. |
| `src/shared/catalog-generators.ts` | Update --llm-help Step 2: "setup creates .mcp.json AND starts daemon". Remove do_not rule "Do NOT start the daemon manually". Add "daemon auto-heals" note. Add status tool to MCP instructions. |
| `README.md` | Update quick start (remove manual `livetap start` step). Update "if daemon is not running" section. Update requirements (just Bun + Claude Code). |
| `CONTRIBUTING.md` | Update architecture description for daemon lifecycle. |
| `src/cli/daemon-client.ts` | Update STATE_PATH for PID file, error message mention `setup` as alternative |

### 1H detail: Complete text surface checklist (28 items)

**README.md (9 items):**
1. Lines 18-23: Quick start `livetap start` → `livetap setup`
2. Line 37: Setup step comment → add "and starts daemon"
3. Line 45: Remove "Do NOT start the daemon manually"
4. Line 50: `12 MCP tools` → `13 MCP tools`
5. Lines 76-80: Mention retry behavior in auto-start section
6. Line 142: CLI comment → `# Start daemon (auto-started by setup/MCP)`
7. Line 179: `12 MCP tools` → `13 MCP tools`
8. After line 194: Add `status` row to MCP tools table
9. Line 235: Mention `daemon.pid` in state directory

**catalog-generators.ts (4 items):**
10. Line 64: Step 2 add "and starts the daemon"
11. Line 71: Rewrite "Do NOT start daemon manually" rule
12. ~Line 143: Add tip about auto-start/retry to MCP instructions
13. ~Line 113: Add `status` tool to MANAGE section

**command-catalog.ts (1 item):**
14. Line 29: `setup` description add "start the daemon"

**tools.ts (3 items):**
15. After line 171: Add 13th `status` tool definition
16. Line 311: Error message mention auto-restart
17. Lines 191-313: Add `case 'status'` handler

**channel.ts (3 items):**
18. Lines 43-51: Auto-start via `npx livetap start`
19. Line 45: Simplify log message
20. Line 94: Remove stale "Phase 3" comment

**setup.ts (2 items):**
21. Lines 63-69: Add daemon start + spinner + success message
22. Line 2: Docstring add "starts the daemon"

**start.ts (2 items):**
23. Line 56: Write `daemon.pid` instead of `state.json`
24. Line 46: Add `proc.unref()`

**stop.ts (2 items):**
25. Line 10: `STATE_PATH` → `PID_PATH` (daemon.pid)
26. Lines 15-28: Read PID from daemon.pid

**status.ts (1 item):**
27. Lines 24-35: Add watcher count to output

**daemon-client.ts (2 items):**
28. Line 9: Update STATE_PATH for daemon.pid
29. Line 35: Error message mention `setup` as alternative

---

## Build Order

1. **Phase 0A:** Build `StreamStore` class with tests
2. **Phase 0B:** Replace Redis calls in subscribers (mqtt, ws, file, webhook)
3. **Phase 0C:** Replace Redis in connection-manager and watchers/manager
4. **Phase 0D:** Replace Redis in daemon index.ts, update tests, remove deps
5. **Phase 0E:** Run full test suite, verify everything passes
6. **Phase 0F:** Update all Redis references in docs (README, CONTRIBUTING, CLAUDE.md, CLI, MCP tools, memory)
7. **Phase 1A-1C:** Daemon lifecycle (setup starts daemon, daemonize with unref + PID file, start.ts/stop.ts)
8. **Phase 1D-1E:** MCP proxy fallback (channel.ts via CLI) + tool retry (tools.ts)
9. **Phase 1F:** Status MCP tool (13th tool)
10. **Phase 1G:** SSE reconnect verification
11. **Phase 1H:** Update ALL docs/help/instructions (10 files — see table in 1H)

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
