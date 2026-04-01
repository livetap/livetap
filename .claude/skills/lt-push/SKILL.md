---
name: lt-push
description: Pre-push checklist for livetap — verify tests, drift detection, regenerate README/CONTRIBUTING from canonical data, audit agent install flow, update memory, commit and push.
---
# lt-push

## Instructions

Run this skill before pushing changes to the livetap repo. It runs tests (including drift detection), regenerates README and CONTRIBUTING from canonical data if needed, audits the agent install flow, updates memory, and commits.

The livetap repo is at `/Users/rupulsafaya/Documents/GitHub/livetap`.

## Steps

### 1. Run tests (including drift detection)

Run `bun test` and verify ALL tests pass, including the canonical drift detection tests in `tests/phase0/canonical-drift.test.ts`. Do NOT push if any tests fail. If drift tests fail, it means canonical data was changed but a doc surface wasn't updated — fix it first.

Note: some tests use fixed ports (28788-28792). If tests fail with EADDRINUSE, kill stale processes.

### 2. Audit test adequacy

For each feature area, check that tests cover real scenarios — not just happy paths. Compare test files against the source code they test. See existing test coverage for:
- Source protocols (`src/server/connections/*.ts`)
- Watcher engine operators (`src/server/watchers/engine.ts`)
- Watcher manager plain text handling (`src/server/watchers/manager.ts`)
- CLI URI parsing (`src/cli/*.ts`)

Flag and add missing tests before continuing.

### 3. Regenerate README and CONTRIBUTING (if canonical data changed)

Check if any files in `src/shared/canonical/` changed since last push:
```bash
git diff --name-only HEAD -- src/shared/canonical/
```

If canonical files changed:
1. Read the full canonical data: `src/shared/canonical/index.ts` (barrel), especially `meta.ts` for readmeSpec, contributingSpec, examples, and all structured data
2. Read the current README.md and CONTRIBUTING.md
3. Regenerate README.md using canonical data + `META.readmeSpec`:
   - Follow the section order in `readmeSpec.sections`
   - Follow the tone and audience guidance
   - ALL facts (tools, commands, operators, source types, examples, do-not rules) MUST come from canonical data
   - The architecture diagram is in `META.architectureDiagram` (use as-is)
   - Examples come from `META.examples` (structured objects — flesh out into prose)
   - Tool count = `TOOLS.length`, command count = `CLI_COMMANDS.length`
4. Regenerate CONTRIBUTING.md using canonical data + `META.contributingSpec`
5. Verify `package.json` description matches `META.npmDescription`. Update if not.
6. Re-run `bun test` to confirm drift tests pass with the new README

### 4. Audit agent install flow (npm description -> --llm-help -> MCP instructions)

Walk through the agent discovery journey:

**Step A: npm description** (`META.npmDescription` in canonical, `description` in package.json)
- Does it say what livetap does + include agent call-to-action?

**Step B: --llm-help** (run `bun bin/livetap.ts --llm-help`)
- Version matches package.json?
- Setup steps, do_not rules, commands, tools all from canonical?

**Step C: MCP instructions** (`generateInstructions()` output)
- All tools referenced? Workflow accurate? Data shapes correct? Tips true?

**Flow coherence:** npm description -> --llm-help -> setup -> restart -> MCP tools

### 5. Scan for orphan files

Check `git status` for untracked files that shouldn't be in the repo:
- `*.tgz` — npm pack artifacts (delete, should be in .gitignore)
- `dump.rdb` — stale Redis snapshots (delete, should be in .gitignore)
- `*.log` files in the root — stale logs
- Any file that looks like a build artifact, temp file, or leftover from a previous phase

If found: delete the file, ensure the pattern is in `.gitignore`, and flag it to the user.

### 6. Verify no stale references

- No references to Redis/ioredis in source files (docs/PLAN archives are OK)
- No hardcoded version strings (should read from package.json)
- No hardcoded tool/command counts (should derive from arrays)

### 7. Check PLAN.md status

Verify phases marked as "DONE" have code + tests. Phases not built are not marked done.

### 8. Update memory

Update Claude's persistent memory at `~/.claude/projects/-Users-rupulsafaya-Documents-GitHub-livetap/memory/`:
- `MEMORY.md` — Current state, key architecture, new gotchas
- Remove stale or session-specific notes

### 9. Commit and push

1. Stage changed files specifically (don't `git add .`)
2. Write a descriptive commit message
3. Ask the user before pushing if there are surprising changes
4. Push to remote
