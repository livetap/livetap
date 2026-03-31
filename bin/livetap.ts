#!/usr/bin/env bun
/**
 * livetap CLI entry point.
 */

const [cmd, ...args] = Bun.argv.slice(2)

const commands: Record<string, () => Promise<void>> = {
  start:    () => import('../src/cli/start.js').then((m) => m.run(args)),
  stop:     () => import('../src/cli/stop.js').then((m) => m.run(args)),
  status:   () => import('../src/cli/status.js').then((m) => m.run(args)),
  tap:      () => import('../src/cli/tap.js').then((m) => m.run(args)),
  untap:    () => import('../src/cli/untap.js').then((m) => m.run(args)),
  taps:     () => import('../src/cli/taps.js').then((m) => m.run(args)),
  sip:      () => import('../src/cli/sip.js').then((m) => m.run(args)),
  watch:    () => import('../src/cli/watch.js').then((m) => m.run(args)),
  unwatch:  () => import('../src/cli/unwatch.js').then((m) => m.run(args)),
  watchers: () => import('../src/cli/watchers.js').then((m) => m.run(args)),
  mcp:      () => import('../src/mcp/channel.js'),
  help:     () => import('../src/cli/help.js').then((m) => m.run(args)),
}

if (!cmd || cmd === '--help' || cmd === '-h') {
  await commands.help()
} else if (cmd === '--llm-help') {
  const { generateLlmHelp } = await import('../src/shared/catalog-generators.js')
  console.log(JSON.stringify(generateLlmHelp(), null, 2))
} else if (commands[cmd]) {
  await commands[cmd]()
} else {
  console.error(`Unknown command: ${cmd}. Run 'livetap help' for usage.`)
  process.exit(1)
}
