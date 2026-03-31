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
  const { TOOLS } = await import('../src/mcp/tools.js')
  console.log(JSON.stringify({
    name: 'livetap',
    version: '0.1.0',
    description: 'Push live data streams into your AI coding agent',
    commands: [
      { name: 'start', usage: 'livetap start', description: 'Start the livetap daemon', flags: [{ name: '--port', type: 'number', default: 8788 }, { name: '--foreground', type: 'boolean' }] },
      { name: 'stop', usage: 'livetap stop', description: 'Stop the daemon' },
      { name: 'status', usage: 'livetap status', description: 'Show daemon, taps, and watchers', flags: [{ name: '--json', type: 'boolean' }] },
      { name: 'tap', usage: 'livetap tap <uri|file.json>', description: 'Tap into a data source', args: [{ position: 0, name: 'source', required: true }], flags: [{ name: '--name', type: 'string' }], examples: ['livetap tap mqtt://broker.emqx.io:1883/sensors/#', 'livetap tap wss://stream.example.com/prices', 'livetap tap webhook', 'livetap tap connection.json'] },
      { name: 'untap', usage: 'livetap untap <connectionId>', description: 'Remove a tap', args: [{ position: 0, name: 'connectionId', required: true }] },
      { name: 'taps', usage: 'livetap taps', description: 'List active taps', flags: [{ name: '--json', type: 'boolean' }] },
      { name: 'sip', usage: 'livetap sip <connectionId>', description: 'Sample recent stream entries', args: [{ position: 0, name: 'connectionId', required: true }], flags: [{ name: '--max', type: 'number', default: 10 }, { name: '--back', type: 'number', default: 60 }, { name: '--raw', type: 'boolean' }] },
      { name: 'watch', usage: 'livetap watch <connId> "expression"', description: 'Create a watcher', args: [{ position: 0, name: 'connectionId', required: true }, { position: 1, name: 'expression', required: true }], flags: [{ name: '--cooldown', type: 'number', default: 60 }, { name: '--action', type: 'string' }], examples: ['livetap watch conn_abc "temperature > 50"', 'livetap watch conn_abc "temp > 50 AND humidity > 90"'] },
      { name: 'unwatch', usage: 'livetap unwatch <watcherId>', description: 'Remove a watcher', args: [{ position: 0, name: 'watcherId', required: true }] },
      { name: 'watchers', usage: 'livetap watchers [connectionId]', description: 'List watchers', flags: [{ name: '--json', type: 'boolean' }, { name: '--logs', type: 'string', description: 'Show logs for a watcher ID' }] },
    ],
    mcp_tools: TOOLS,
  }, null, 2))
} else if (commands[cmd]) {
  await commands[cmd]()
} else {
  console.error(`Unknown command: ${cmd}. Run 'livetap help' for usage.`)
  process.exit(1)
}
