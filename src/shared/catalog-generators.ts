/**
 * Generates help text, --llm-help JSON, and MCP instructions from the command catalog.
 */

import { CLI_COMMANDS, type CatalogCommand } from './command-catalog.js'
import { TOOLS } from '../mcp/tools.js'

/**
 * Generate human-readable --help text.
 */
export function generateHelpText(): string {
  const lines: string[] = [
    'livetap — Push live data streams into your AI coding agent',
    '',
    'Usage:',
  ]

  // Group: daemon, connections, sampling, watchers
  const groups: { label: string; commands: string[] }[] = [
    { label: '', commands: ['start', 'stop', 'status'] },
    { label: '', commands: ['tap', 'untap', 'taps'] },
    { label: '', commands: ['sip'] },
    { label: '', commands: ['watch', 'unwatch', 'watchers'] },
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
    name: 'livetap',
    version: '0.1.0',
    description: 'Push live data streams into your AI coding agent',
    commands: CLI_COMMANDS,
    mcp_tools: TOOLS,
  }
}

/**
 * Generate MCP instructions string for the LLM.
 * References actual tool names from the TOOLS array.
 */
export function generateInstructions(): string {
  const toolNames = TOOLS.map((t) => t.name)
  const connectionTools = toolNames.filter((n) => n.includes('connection'))
  const watcherTools = toolNames.filter((n) => n.includes('watcher') || n.includes('watch'))

  return `
You have access to livetap, a live data streaming tool. Use it to connect to data sources, sample streams, and set up expression-based watchers that alert you when conditions match.

WORKFLOW:
1. CONNECT: Use create_connection to tap into a data source.
   - MQTT: create_connection({ type: "mqtt", broker: "hostname", port: 1883, tls: false, topics: ["topic/#"], username: "", password: "" })
   - WebSocket: create_connection({ type: "websocket", url: "wss://..." })
   - File: create_connection({ type: "file", path: "/var/log/app.log" }) → tails the file for new lines
   Note: for MQTT, set tls: false and port: 1883 for unencrypted brokers.

2. SAMPLE: Use read_stream to inspect what data is flowing.
   - read_stream({ connectionId: "conn_xxx", backfillSeconds: 60, maxEntries: 10 })
   - Study the JSON payload structure to find the correct dot-paths for watchers.
   - ALWAYS sample before creating a watcher so you know the correct field paths.

3. WATCH: Use create_watcher to set up expression-based alerts.
   - create_watcher({ connectionId: "conn_xxx", conditions: [{ field: "sensors.temperature.value", op: ">", value: 50 }], match: "all", cooldown: 60 })
   - Supported operators: >, <, >=, <=, ==, !=, contains, matches (regex)
   - match: "all" = AND (all conditions must be true), "any" = OR (at least one)
   - cooldown: seconds between repeated alerts. Use 0 for rare events, 30-60 for sensors, 300+ for high-frequency.
   - Alerts arrive as <channel> events. When you see one, act on it as the user requested.

4. MANAGE:
   - ${connectionTools.join(', ')} — manage connections
   - ${watcherTools.join(', ')} — manage watchers
   - Watcher IDs (w_xxx) are globally unique. No connectionId needed for get/update/delete.

CHANNEL EVENTS:
- <channel source="livetap" type="alert"> = a watcher condition matched. Read the payload and act on it.
  The payload contains: watcherId, expression, matched_values, and the full stream entry.

When the user asks to "monitor", "watch", or "alert on" something:
1. First check list_connections — reuse an existing connection if possible
2. If no connection exists, create one
3. Sample the stream with read_stream to understand the data shape
4. Create a watcher with the correct field paths from the sample
5. Tell the user what you set up and what will trigger it

AVAILABLE TOOLS: ${toolNames.join(', ')}

DATA SHAPE BY SOURCE:
- MQTT/WebSocket: entries have { payload: "{...json...}", topic: "..." }. The payload is parsed as JSON.
  Use dot-paths into the parsed JSON: "sensors.temperature.value", "metadata.device_name"
- File (plain text lines): entries have { payload: "the raw line", format: "text" }.
  Use field "payload" with contains/matches: { field: "payload", op: "contains", value: "ERROR" }
  or { field: "payload", op: "matches", value: "5[0-9]{2}" }
- File (JSON lines): entries have { payload: "{...json...}", format: "json" }. Parsed as JSON.
  Use dot-paths like MQTT: "level", "msg", "status"
- IMPORTANT: always use read_stream first to see the actual field names. Do NOT guess — the field is "payload", not "line" or "message".

TIPS:
- Watcher IDs (w_xxx) are globally unique. You don't need the connectionId to get, update, or delete a watcher.
- Common MQTT brokers: broker.emqx.io (public demo), test.mosquitto.org (public test).
- For regex watchers, use the "matches" operator: { field: "payload", op: "matches", value: "ERROR|FATAL" }
- If a field path doesn't exist in the payload, the condition evaluates to false (no crash, no error).
`.trim()
}
