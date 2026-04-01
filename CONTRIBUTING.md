# Contributing to LiveTap

## Setup

```bash
git clone https://github.com/livetap/livetap.git
cd livetap
bun install
bun test
```

**Requirements:** Bun 1.0+

## Architecture

LiveTap has two processes:

- **Daemon** (`src/server/index.ts`) — background process on :8788 with in-memory StreamStore, manages connections and watchers
- **MCP proxy** (`src/mcp/channel.ts`) — thin stdio proxy spawned by Claude Code, proxies tools to daemon, pushes channel alerts

Key modules:
- `src/shared/canonical/` — single source of truth for all tool schemas, CLI commands, and metadata
- `src/server/connections/` — protocol subscribers (MQTT, WebSocket, file, webhook)
- `src/server/watchers/` — expression engine, watcher manager, types
- `src/shared/catalog-generators.ts` — generates --help, --llm-help, MCP instructions from canonical data
- `src/cli/` — CLI commands (setup, tap, sip, watch, etc.)
- `bin/livetap.ts` — CLI entry point

See [docs/PLAN.md](docs/PLAN.md) for the documentation system design.

## Adding a new protocol

1. Add config type to `src/server/types.ts` (discriminated union)
2. Create subscriber in `src/server/connections/your-protocol.ts` — implement the `Subscriber` interface
3. Wire into `src/server/connection-manager.ts` — add the `else if` case in `create()`
4. Add to `src/shared/canonical/tools.ts` — add the type to the `create_connection` tool enum
5. Add to `src/shared/canonical/meta.ts` — add to `sourceTypes` array
6. Add to `src/cli/tap.ts` — URI parsing
7. Add to `src/shared/canonical/cli.ts` — examples
8. Add tests in `tests/`
9. Run `bun test` — drift detection tests will verify all doc surfaces pick up the new type

## Running tests

```bash
bun test                         # All tests
bun test tests/phase0/           # Canonical drift detection
bun test tests/phase1/           # Daemon lifecycle
bun test tests/phase-file/       # File tailing
SKIP_LIVE_MQTT=1 bun test        # Skip tests needing external brokers
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
- `bun test` must pass (including drift detection)
- Add tests for new features
- If you change canonical data, the drift tests will tell you what else needs updating
