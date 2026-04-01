---
description: LiveTap project rules — canonical data, Bun, doc system.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, *.md, package.json"
alwaysApply: true
---

## LiveTap Project Rules

### Documentation: Single Source of Truth

All user-facing and agent-facing documentation is generated from canonical data in `src/shared/canonical/`.

**NEVER edit these files directly:**
- `README.md` — generated from canonical data by Claude Code at publish time
- `CONTRIBUTING.md` — generated from canonical data by Claude Code at publish time

**To change documentation, edit the canonical source:**
- Tool schemas → `src/shared/canonical/tools.ts`
- CLI commands → `src/shared/canonical/cli.ts`
- Everything else (descriptions, operators, source types, examples, do-not rules, tips, data shapes) → `src/shared/canonical/meta.ts`
- Barrel re-export → `src/shared/canonical/index.ts`

**After changing canonical data:**
1. Run `bun test` — drift detection tests (`tests/phase0/canonical-drift.test.ts`) verify all doc surfaces reference all canonical entries
2. Regenerate README.md and CONTRIBUTING.md from canonical data (use `/lt-push` skill or regenerate manually following `META.readmeSpec` and `META.contributingSpec`)
3. Sync `package.json` description with `META.npmDescription` if changed

**Runtime generators** (these read canonical data automatically, no regeneration needed):
- `--help` → `generateHelpText()` in `src/shared/catalog-generators.ts`
- `--llm-help` → `generateLlmHelp()` in `src/shared/catalog-generators.ts`
- MCP instructions → `generateInstructions()` in `src/shared/catalog-generators.ts`

### Bun

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
