# Contributing to livetap

## Setup

```bash
git clone https://github.com/livetap/livetap.git
cd livetap && git checkout v0
bun install
bun test
```

**Requirements:** Bun 1.0+

## Architecture

livetap has two processes:

- **Daemon** (`src/server/index.ts`) — background process on :8788 with in-memory stream buffer, manages connections and watchers
- **MCP proxy** (`src/mcp/channel.ts`) — thin stdio proxy spawned by Claude Code, proxies tools to daemon, pushes channel alerts

Key modules:
- `src/server/connections/` — protocol subscribers (MQTT, WebSocket, file, webhook)
- `src/server/watchers/` — expression engine, watcher manager, types
- `src/shared/` — command catalog (single source for CLI help, --llm-help, MCP instructions)
- `src/cli/` — CLI commands (tap, sip, watch, etc.)
- `bin/livetap.ts` — CLI entry point

See [docs/PLAN.md](docs/PLAN.md) for the full build plan.

## Adding a new protocol

1. Add config type to `src/server/types.ts` (discriminated union)
2. Create subscriber in `src/server/connections/your-protocol.ts` — implement the `Subscriber` interface
3. Wire into `src/server/connection-manager.ts` — add the `else if` case in `create()`
4. Add to `src/mcp/tools.ts` — add the type to the `create_connection` tool enum
5. Add to `src/cli/tap.ts` — URI parsing
6. Add to `src/shared/command-catalog.ts` — examples
7. Add tests in `tests/`
8. Update README protocol table

## Running tests

```bash
bun test                         # All 103 tests
bun test tests/phase1/           # Specific phase
bun test tests/phase-file/       # File tailing tests
SKIP_LIVE_MQTT=1 bun test        # Skip tests needing broker.emqx.io
```

Test ports use the 28xxx range. If tests fail with EADDRINUSE:
```bash
lsof -ti :28788 :28789 :28790 :28791 :28792 :28793 :28794 :28795 | xargs kill
```

## Code style

- Bun, not Node — use `Bun.serve`, `Bun.file`, `Bun.spawn`
- No frameworks — minimal deps
- TypeScript, no build step — Bun runs .ts directly
- Tests with `bun:test`

## Pull requests

- Target the `v0` branch
- `bun test` must pass
- Add tests for new features
- Update README if adding user-facing changes
