#!/usr/bin/env bun
/**
 * livetap MCP Channel Proxy
 *
 * Thin MCP server spawned by Claude Code as a subprocess (stdio transport).
 * - Declares claude/channel capability for push notifications
 * - Proxies all tool calls to the livetap daemon on :8788
 * - Holds SSE connection to daemon /events for alert delivery
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerTools } from './tools.js'

const DAEMON_PORT = parseInt(process.env.LIVETAP_PORT || '8788')
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`

const INSTRUCTIONS = `
You have access to livetap, a live data streaming tool. Use it to connect to data sources, sample streams, and set up expression-based watchers that alert you when conditions match.

WORKFLOW:
1. CONNECT: Use create_connection to tap into a data source.
   - MQTT: create_connection({ type: "mqtt", broker: "hostname", port: 1883, tls: false, topics: ["topic/#"], username: "", password: "" })
   - WebSocket: create_connection({ type: "websocket", url: "wss://..." })
   - Webhook: create_connection({ type: "webhook" }) → returns an ingest URL
   Note: for MQTT, set tls: false and port: 1883 for unencrypted brokers.

2. SAMPLE: Use read_stream to inspect what data is flowing.
   - read_stream({ connectionId: "conn_xxx", backfillSeconds: 60, maxEntries: 10 })
   - Study the JSON payload structure to find the correct dot-paths for watchers.
   - ALWAYS sample before creating a watcher so you know the correct field paths.

3. WATCH: Use create_watcher to set up expression-based alerts.
   - create_watcher({ connectionId: "conn_xxx", conditions: [{ field: "sensors.temperature.value", op: ">", value: 50 }], match: "all", cooldown: 60 })
   - Supported operators: >, <, >=, <=, ==, !=, contains
   - match: "all" = AND (all conditions must be true), "any" = OR (at least one)
   - cooldown: seconds between repeated alerts. Use 0 for rare events, 30-60 for sensors, 300+ for high-frequency.
   - Alerts arrive as <channel> events. When you see one, act on it as the user requested.

4. MANAGE:
   - list_connections — see all active connections
   - list_watchers — see all watchers (optionally filter by connectionId)
   - get_watcher — get details of a specific watcher by ID (no connectionId needed)
   - get_watcher_logs — see MATCH/SUPPRESSED/ERROR events for a watcher
   - update_watcher — change conditions, cooldown, or action
   - delete_watcher — stop and remove a watcher (just needs watcher ID)
   - destroy_connection — remove a connection and its stream

CHANNEL EVENTS:
- <channel source="livetap" type="alert"> = a watcher condition matched. Read the payload and act on it.
  The payload contains: watcherId, expression, matched_values, and the full stream entry.

When the user asks to "monitor", "watch", or "alert on" something:
1. First check list_connections — reuse an existing connection if possible
2. If no connection exists, create one
3. Sample the stream with read_stream to understand the data shape
4. Create a watcher with the correct field paths from the sample
5. Tell the user what you set up and what will trigger it

TIPS:
- Watcher IDs (w_xxx) are globally unique. You don't need the connectionId to get, update, or delete a watcher.
- Common MQTT brokers: broker.emqx.io (public demo), test.mosquitto.org (public test).
- Webhook connections return an ingest URL — give this to the user or to an external service.
- If a field path doesn't exist in the payload, the condition evaluates to false (no crash, no error).
`.trim()

async function waitForDaemon(maxWaitMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${DAEMON_URL}/status`)
      if (res.ok) return true
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

async function autoStartDaemon(): Promise<boolean> {
  // Check if already running
  try {
    const res = await fetch(`${DAEMON_URL}/status`)
    if (res.ok) return true
  } catch { /* not running */ }

  // Auto-start the daemon
  console.error('[livetap-mcp] Daemon not running, auto-starting...')
  Bun.spawn(['bun', 'src/server/index.ts'], {
    env: { ...process.env, LIVETAP_PORT: String(DAEMON_PORT) },
    stdout: 'ignore',
    stderr: 'ignore',
  })

  return waitForDaemon()
}

async function connectToSSE(mcp: Server) {
  try {
    const res = await fetch(`${DAEMON_URL}/events`)
    if (!res.ok || !res.body) return

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          try {
            const event = JSON.parse(data)
            await mcp.notification({
              method: 'notifications/claude/channel',
              params: {
                content: JSON.stringify(event.payload ?? event),
                meta: {
                  type: event.type ?? 'alert',
                  ...(event.connectionId && { connection: event.connectionId }),
                  ...(event.watcherId && { watcher: event.watcherId }),
                },
              },
            })
          } catch { /* malformed event */ }
        }
      }
    }
  } catch {
    // SSE connection failed — daemon may not support /events yet (Phase 3)
    // Silently retry after delay
    setTimeout(() => connectToSSE(mcp), 5000)
  }
}

async function main() {
  const daemonReady = await autoStartDaemon()
  if (!daemonReady) {
    console.error('[livetap-mcp] WARNING: Could not connect to daemon. Tools may fail.')
  }

  const mcp = new Server(
    { name: 'livetap', version: '0.1.0' },
    {
      capabilities: {
        experimental: { 'claude/channel': {} },
        tools: {},
      },
      instructions: INSTRUCTIONS,
    },
  )

  registerTools(mcp, DAEMON_URL)

  await mcp.connect(new StdioServerTransport())
  console.error('[livetap-mcp] MCP channel proxy connected')

  // Start SSE listener for alert delivery (non-blocking)
  connectToSSE(mcp)
}

main()
