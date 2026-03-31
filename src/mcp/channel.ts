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
You have access to livetap, a live data streaming tool. Use it to connect to data sources and monitor them in real-time.

WORKFLOW:
1. CONNECT: Use create_connection to tap into a data source.
   - MQTT: create_connection({ type: "mqtt", broker: "hostname", port: 1883, topics: ["topic/#"] })
   - WebSocket: create_connection({ type: "websocket", url: "wss://..." })
   - Webhook: create_connection({ type: "webhook" }) → returns an ingest URL
   Note: for MQTT, set tls: false and port: 1883 for unencrypted brokers.

2. SAMPLE: Use read_stream to see what data is flowing through a connection.
   - read_stream({ connectionId: "conn_xxx", backfillSeconds: 60, maxEntries: 10 })
   - Look at the data structure to understand field paths for watchers.
   - ALWAYS sample before creating a watcher so you know the correct field paths.

3. WATCH: Use create_watcher to set up alerts on conditions (available after Phase 3).
   - Alerts arrive as <channel> events. When you see one, act on it as the user requested.

4. MANAGE: Use list_connections, destroy_connection to manage active connections.

CHANNEL EVENTS:
- <channel source="livetap" type="alert"> = a watcher condition matched. Read the payload and act.
- <channel source="livetap" type="sample"> = periodic data sample. Informational.

When the user asks to "monitor", "watch", or "alert on" something:
1. First create a connection to the data source if one doesn't exist
2. Sample the stream to understand the data shape
3. Then create a watcher with the right field paths
4. Tell the user what you set up and what will trigger it

TIPS:
- Use list_connections to see what's already connected before creating duplicates.
- Common MQTT brokers: broker.emqx.io (public demo), test.mosquitto.org (public test).
- Webhook connections return an ingest URL — give this to the user or external service.
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
