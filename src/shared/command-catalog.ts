/**
 * Command Catalog — single source of truth for all CLI commands and MCP tools.
 *
 * Consumed by:
 *   1. src/mcp/tools.ts         → MCP tool registration (imports TOOLS directly)
 *   2. src/mcp/channel.ts       → LLM instructions (imports generateInstructions)
 *   3. bin/livetap.ts --help    → human-readable help (imports generateHelpText)
 *   4. bin/livetap.ts --llm-help → machine-readable JSON (imports generateLlmHelp)
 */

export interface CatalogCommand {
  name: string
  usage: string
  description: string
  args?: { position: number; name: string; required: boolean; description?: string }[]
  flags?: { name: string; type: string; default?: unknown; description: string }[]
  examples?: string[]
}

/**
 * All CLI commands. This is the single source — help text and --llm-help
 * are generated from this array.
 */
export const CLI_COMMANDS: CatalogCommand[] = [
  // --- Daemon ---
  {
    name: 'start',
    usage: 'livetap start',
    description: 'Start the livetap daemon (embedded Redis + HTTP API)',
    flags: [
      { name: '--port', type: 'number', default: 8788, description: 'Daemon port (env: LIVETAP_PORT)' },
      { name: '--foreground', type: 'boolean', description: 'Run in foreground (don\'t detach)' },
    ],
  },
  {
    name: 'stop',
    usage: 'livetap stop',
    description: 'Stop the daemon',
  },
  {
    name: 'status',
    usage: 'livetap status',
    description: 'Show daemon, taps, and watchers',
    flags: [
      { name: '--json', type: 'boolean', description: 'Output as JSON' },
    ],
  },
  // --- Connections ---
  {
    name: 'tap',
    usage: 'livetap tap <uri|file.json>',
    description: 'Tap into a data source (MQTT, WebSocket, or webhook)',
    args: [
      { position: 0, name: 'source', required: true, description: 'URI (mqtt://..., wss://...), "webhook", or a .json config file' },
    ],
    flags: [
      { name: '--name', type: 'string', description: 'Display name for the connection' },
    ],
    examples: [
      'livetap tap mqtt://broker.emqx.io:1883/sensors/#',
      'livetap tap wss://stream.example.com/prices',
      'livetap tap webhook',
      'livetap tap connection.json',
    ],
  },
  {
    name: 'untap',
    usage: 'livetap untap <connectionId>',
    description: 'Remove a tap',
    args: [
      { position: 0, name: 'connectionId', required: true },
    ],
  },
  {
    name: 'taps',
    usage: 'livetap taps',
    description: 'List active taps',
    flags: [
      { name: '--json', type: 'boolean', description: 'Output as JSON' },
    ],
  },
  // --- Sampling ---
  {
    name: 'sip',
    usage: 'livetap sip <connectionId>',
    description: 'Sip from a stream (sample recent entries as pretty JSON)',
    args: [
      { position: 0, name: 'connectionId', required: true },
    ],
    flags: [
      { name: '--max', type: 'number', default: 10, description: 'Max entries to return' },
      { name: '--back', type: 'number', default: 60, description: 'Backfill seconds' },
      { name: '--raw', type: 'boolean', description: 'Output raw JSON' },
    ],
  },
  // --- Watchers ---
  {
    name: 'watch',
    usage: 'livetap watch <connectionId> "expression"',
    description: 'Create an expression-based watcher',
    args: [
      { position: 0, name: 'connectionId', required: true },
      { position: 1, name: 'expression', required: true, description: '"field > value", supports AND/OR' },
    ],
    flags: [
      { name: '--cooldown', type: 'number', default: 60, description: 'Seconds between repeated alerts (0 = every match)' },
      { name: '--action', type: 'string', description: '"channel_alert" (default), "webhook:URL", or "shell:command"' },
    ],
    examples: [
      'livetap watch conn_abc "temperature > 50"',
      'livetap watch conn_abc "temp > 50 AND humidity > 90"',
      'livetap watch conn_abc "temp > 50 OR smoke > 0.05"',
      'livetap watch conn_abc "price > 70000" --cooldown 300',
    ],
  },
  {
    name: 'unwatch',
    usage: 'livetap unwatch <watcherId>',
    description: 'Remove a watcher',
    args: [
      { position: 0, name: 'watcherId', required: true },
    ],
  },
  {
    name: 'watchers',
    usage: 'livetap watchers [connectionId|watcherId]',
    description: 'List watchers, show watcher details, or view watcher logs',
    args: [
      { position: 0, name: 'connectionId or watcherId', required: false, description: 'Filter by connection (conn_xxx) or show details for a watcher (w_xxx)' },
    ],
    flags: [
      { name: '--json', type: 'boolean', description: 'Output as JSON' },
      { name: '--logs', type: 'string', description: 'Show evaluation logs for a watcher ID' },
    ],
    examples: [
      'livetap watchers',
      'livetap watchers conn_abc',
      'livetap watchers w_abc',
      'livetap watchers --logs w_abc',
    ],
  },
]
