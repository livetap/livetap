/**
 * Generates help text, --llm-help JSON, and MCP instructions from canonical data.
 * All generators consume the single source of truth in ./canonical/.
 */

import { CLI_COMMANDS, type CatalogCommand, TOOLS, META } from './canonical/index.js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const PKG = JSON.parse(readFileSync(resolve(import.meta.dir, '../../package.json'), 'utf-8'))
const VERSION: string = PKG.version

/**
 * Generate human-readable --help text.
 */
export function generateHelpText(): string {
  const lines: string[] = [
    `${META.name} — ${META.description}`,
    '',
    'Usage:',
  ]

  const groups: { commands: string[] }[] = [
    { commands: ['setup'] },
    { commands: ['start', 'stop', 'status'] },
    { commands: ['tap', 'untap', 'taps'] },
    { commands: ['sip'] },
    { commands: ['watch', 'unwatch', 'watchers'] },
  ]

  for (const group of groups) {
    for (const name of group.commands) {
      const cmd = CLI_COMMANDS.find((c) => c.name === name)
      if (!cmd) continue
      lines.push(`  ${cmd.usage.padEnd(45)} ${cmd.description}`)
    }
    lines.push('')
  }

  lines.push('Options:')
  lines.push('  --port <n>        Daemon port (default 8788, env: LIVETAP_PORT)')
  lines.push('  --foreground      Run daemon in foreground (start only)')
  lines.push('  --json            Output as JSON (taps, watchers, sip)')
  lines.push('  --help, -h        Show this help')
  lines.push('  --llm-help        Machine-readable JSON for AI agents')
  lines.push('')

  return lines.join('\n')
}

/**
 * Generate machine-readable JSON for --llm-help.
 * Includes CLI commands AND MCP tool schemas from the same source.
 */
export function generateLlmHelp(): object {
  return {
    name: META.name,
    version: VERSION,
    description: META.description,
    setup: {
      steps: META.setupSteps,
      do_not: META.doNotRules,
    },
    commands: CLI_COMMANDS,
    mcp_tools: TOOLS,
  }
}

/**
 * Generate MCP instructions string for the LLM.
 * Assembled entirely from canonical data — no hand-written prose.
 */
export function generateInstructions(): string {
  const toolNames = TOOLS.map((t) => t.name)
  const connectionTools = toolNames.filter((n) => n.includes('connection'))
  const watcherTools = toolNames.filter((n) => n.includes('watcher') || n.includes('watch'))

  // Build source type examples for CONNECT section
  const sourceExamples = META.sourceTypes
    .filter((s) => s.status !== 'built-deferred')
    .map((s) => {
      switch (s.type) {
        case 'mqtt':
          return `   - MQTT: create_connection({ type: "mqtt", broker: "hostname", port: 1883, tls: false, topics: ["topic/#"], username: "", password: "" })`
        case 'websocket':
          return `   - WebSocket: create_connection({ type: "websocket", url: "wss://..." })`
        case 'file':
          return `   - File: create_connection({ type: "file", path: "/var/log/app.log" }) → tails the file for new lines`
        default:
          return `   - ${s.type}: create_connection(${s.params})`
      }
    })
    .join('\n')

  // Build operator list from canonical
  const operatorList = META.operators.join(', ')

  // Build data shape section from canonical
  const dataShapeLines = META.dataShapes.map((ds) => {
    return `- ${ds.source} (${ds.format}): ${ds.description}\n  ${ds.usage}`
  }).join('\n')

  // Build alert guidance from canonical
  const alertGuidanceLines = META.alertGuidance.map((g) => `- ${g}`).join('\n')

  // Build tips section from canonical
  const tipLines = META.tips.map((t) => `- ${t}`).join('\n')

  return `
You have access to LiveTap, a live data streaming tool. Use it to connect to data sources, sample streams, and set up expression-based watchers that alert you when conditions match.

WORKFLOW:
1. CONNECT: Use create_connection to tap into a data source.
${sourceExamples}
   Note: for MQTT, set tls: false and port: 1883 for unencrypted brokers.

2. SAMPLE: Use read_stream to inspect what data is flowing.
   - read_stream({ connectionId: "conn_xxx", backfillSeconds: 60, maxEntries: 10 })
   - Study the JSON payload structure to find the correct dot-paths for watchers.
   - ALWAYS sample before creating a watcher so you know the correct field paths.

3. WATCH: Use create_watcher to set up expression-based alerts.
   - create_watcher({ connectionId: "conn_xxx", conditions: [{ field: "sensors.temperature.value", op: ">", value: 50 }], match: "all", cooldown: 60 })
   - Supported operators: ${operatorList} (regex)
   - match: "all" = AND (all conditions must be true), "any" = OR (at least one)
   - cooldown: seconds between repeated alerts. Use 0 for rare events, 30-60 for sensors, 300+ for high-frequency.
   - Alerts arrive as <channel> events. When you see one, act on it as the user requested.

4. MANAGE:
   - ${connectionTools.join(', ')} — manage connections
   - ${watcherTools.join(', ')} — manage watchers
   - status — check daemon health, uptime, active connections and watchers
   - Watcher IDs (w_xxx) are globally unique. No connectionId needed for get/update/delete.

CHANNEL EVENTS:
- <channel source="LiveTap" type="alert"> = a watcher condition matched. Read the payload and act on it.
  The payload contains: watcherId, expression, matched_values, and the full stream entry.

WHEN AN ALERT FIRES:
${alertGuidanceLines}

When the user asks to "monitor", "watch", or "alert on" something:
1. First check list_connections — reuse an existing connection if possible
2. If no connection exists, create one
3. Sample the stream with read_stream to understand the data shape
4. Create a watcher with the correct field paths from the sample
5. Tell the user what you set up and what will trigger it

AVAILABLE TOOLS: ${toolNames.join(', ')}

DATA SHAPE BY SOURCE:
${dataShapeLines}
- IMPORTANT: always use read_stream first to see the actual field names. Do NOT guess — the field is "payload", not "line" or "message".

TIPS:
${tipLines}
`.trim()
}
