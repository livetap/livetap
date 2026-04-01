/**
 * MCP Tool definitions for livetap.
 * Registers tools on an MCP Server that proxy to the daemon HTTP API.
 */

import { z } from 'zod'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

export const TOOLS = [
  {
    name: 'create_connection',
    description: 'Create a data connection. MQTT: connects to a broker and subscribes to topics. WebSocket: connects to a remote WS URL. Webhook: creates an HTTP ingest endpoint.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', enum: ['mqtt', 'webhook', 'websocket', 'file'], description: 'Source type', default: 'mqtt' },
        name: { type: 'string', description: 'Display name for the connection' },
        broker: { type: 'string', description: 'MQTT broker hostname (required for mqtt)' },
        port: { type: 'number', description: 'Broker port (default 1883 for mqtt)', default: 1883 },
        tls: { type: 'boolean', description: 'Use TLS (default false)', default: false },
        username: { type: 'string', description: 'MQTT username', default: '' },
        password: { type: 'string', description: 'MQTT password', default: '' },
        topics: { type: 'array', items: { type: 'string' }, description: 'MQTT topic filters (required for mqtt)' },
        url: { type: 'string', description: 'WebSocket URL (required for websocket)' },
        headers: { type: 'object', description: 'WebSocket auth headers' },
        handshake: { type: 'string', description: 'Message to send after WS connect (e.g. subscription JSON)' },
        path: { type: 'string', description: 'Absolute file path to tail (required for file type, e.g. "/var/log/app.log")' },
      },
    },
  },
  {
    name: 'list_connections',
    description: 'List all active connections with their status, message rate, and buffered count.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_connection',
    description: 'Get detailed status of a specific connection.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        connectionId: { type: 'string', description: 'The connection ID (e.g. "conn_a1b2c3d4")' },
      },
      required: ['connectionId'],
    },
  },
  {
    name: 'destroy_connection',
    description: 'Destroy a connection — stops the source subscriber, cleans up the stream buffer.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        connectionId: { type: 'string', description: 'The connection ID to destroy' },
      },
      required: ['connectionId'],
    },
  },
  {
    name: 'read_stream',
    description: "Read recent entries from a connection's live stream. Use this to inspect what data is flowing through a connection and understand the payload structure before creating watchers.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        connectionId: { type: 'string', description: 'The connection ID to read from' },
        backfillSeconds: { type: 'number', description: 'Include entries from the last N seconds (default 60)', default: 60 },
        maxEntries: { type: 'number', description: 'Max entries to return (default 10)', default: 10 },
      },
      required: ['connectionId'],
    },
  },
  {
    name: 'create_watcher',
    description: 'Create an expression-based watcher on a connection. The watcher evaluates structured conditions against each stream entry and fires an alert when conditions match. ALWAYS use read_stream first to understand the data shape and field paths.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        connectionId: { type: 'string', description: 'The connection ID to watch' },
        conditions: {
          type: 'array',
          description: 'Array of conditions: [{field: "dot.path", op: ">", value: 50}]. Supported ops: >, <, >=, <=, ==, !=, contains, matches (regex)',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', description: 'Dot-path into the JSON payload (e.g. "sensors.temperature.value")' },
              op: { type: 'string', enum: ['>', '<', '>=', '<=', '==', '!=', 'contains', 'matches'], description: 'Comparison operator. "matches" takes a regex pattern string.' },
              value: { description: 'Value to compare against (number, string, or boolean)' },
            },
            required: ['field', 'op', 'value'],
          },
        },
        match: { type: 'string', enum: ['all', 'any'], description: 'How to combine conditions: "all" (AND) or "any" (OR). Default: "all"', default: 'all' },
        action: { description: '"channel_alert" (default), or {webhook: "url"}, or {shell: "command"}', default: 'channel_alert' },
        cooldown: { type: 'number', description: 'Seconds between repeated alerts. 0 for every match, 60 default. Use 0 for rare events (webhooks), 30-60 for sensors, 300+ for high-frequency streams.', default: 60 },
      },
      required: ['connectionId', 'conditions'],
    },
  },
  {
    name: 'list_watchers',
    description: 'List watchers. Optionally filter by connectionId. If omitted, lists all watchers.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        connectionId: { type: 'string', description: 'Optional: filter by connection ID' },
      },
    },
  },
  {
    name: 'get_watcher',
    description: 'Get details of a specific watcher including conditions, status, match count, and config.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        watcherId: { type: 'string', description: 'The watcher ID' },
      },
      required: ['watcherId'],
    },
  },
  {
    name: 'get_watcher_logs',
    description: 'Get evaluation logs from a watcher — shows MATCH, SUPPRESSED, FIELD_NOT_FOUND, and CHECKPOINT events.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        watcherId: { type: 'string', description: 'The watcher ID' },
        lines: { type: 'number', description: 'Number of log lines to return (default 50)', default: 50 },
      },
      required: ['watcherId'],
    },
  },
  {
    name: 'update_watcher',
    description: "Update a watcher's conditions, match mode, action, or cooldown. The watcher restarts with the new config.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        watcherId: { type: 'string', description: 'The watcher ID' },
        conditions: { type: 'array', description: 'New conditions array', items: { type: 'object' } },
        match: { type: 'string', enum: ['all', 'any'] },
        action: { description: 'New action' },
        cooldown: { type: 'number', description: 'New cooldown in seconds' },
      },
      required: ['watcherId'],
    },
  },
  {
    name: 'delete_watcher',
    description: 'Stop and remove a watcher.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        watcherId: { type: 'string', description: 'The watcher ID to delete' },
      },
      required: ['watcherId'],
    },
  },
  {
    name: 'restart_watcher',
    description: 'Restart a stopped watcher.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        watcherId: { type: 'string', description: 'The watcher ID to restart' },
      },
      required: ['watcherId'],
    },
  },
  {
    name: 'status',
    description: 'Get daemon status: uptime, port, active connections and watchers count.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
]

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] }
}

function error(content: string) {
  return { content: [{ type: 'text' as const, text: content }], isError: true }
}

/**
 * Try to start the daemon via CLI. Returns true if daemon becomes healthy.
 */
async function tryStartDaemon(daemonUrl: string): Promise<boolean> {
  const startScript = new URL('../../bin/livetap.ts', import.meta.url).pathname
  const port = new URL(daemonUrl).port || '8788'
  const proc = Bun.spawn(['bun', startScript, 'start'], {
    env: { ...process.env, LIVETAP_PORT: port },
    stdout: 'ignore',
    stderr: 'ignore',
  })
  proc.unref()

  // Wait up to 15s for daemon to be ready
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${daemonUrl}/status`)
      if (res.ok) return true
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/**
 * Register all livetap MCP tools on the given server.
 * Tools proxy to the daemon HTTP API at the given base URL.
 * Includes auto-restart + retry on connection failure.
 */
export function registerTools(server: Server, daemonUrl: string) {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params
    try {
      switch (name) {
        case 'create_connection': {
          const config: any = { type: args?.type ?? 'mqtt' }
          if (config.type === 'mqtt') {
            config.broker = args?.broker
            config.port = args?.port ?? 1883
            config.tls = args?.tls ?? false
            config.credentials = { username: args?.username ?? '', password: args?.password ?? '' }
            config.topics = args?.topics
            if (!config.broker || !config.topics?.length) {
              return error('Error: broker and topics are required for mqtt connections')
            }
          } else if (config.type === 'websocket') {
            config.url = args?.url
            if (args?.headers) config.headers = args.headers
            if (args?.handshake) config.handshake = args.handshake
            if (!config.url) return error('Error: url is required for websocket connections')
          } else if (config.type === 'file') {
            config.path = args?.path
            if (!config.path) return error('Error: path is required for file connections (e.g. "/var/log/app.log")')
            if (!config.path.startsWith('/')) return error('Error: file path must be absolute')
          }
          // webhook needs no extra params
          const res = await fetch(`${daemonUrl}/connections`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...config, name: args?.name }),
          })
          return text(await res.text())
        }

        case 'list_connections': {
          const res = await fetch(`${daemonUrl}/connections`)
          return text(await res.text())
        }

        case 'get_connection': {
          const res = await fetch(`${daemonUrl}/connections/${args?.connectionId}`)
          if (!res.ok) return error('Connection not found')
          return text(await res.text())
        }

        case 'destroy_connection': {
          const res = await fetch(`${daemonUrl}/connections/${args?.connectionId}`, { method: 'DELETE' })
          if (!res.ok) return error('Connection not found')
          return text(await res.text())
        }

        case 'read_stream': {
          const params = new URLSearchParams()
          if (args?.backfillSeconds) params.set('backfillSeconds', String(args.backfillSeconds))
          if (args?.maxEntries) params.set('maxEntries', String(args.maxEntries))
          const res = await fetch(`${daemonUrl}/connections/${args?.connectionId}/stream?${params}`)
          if (!res.ok) return error('Connection not found')
          return text(await res.text())
        }

        case 'create_watcher': {
          const res = await fetch(`${daemonUrl}/watchers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              connectionId: args?.connectionId,
              conditions: args?.conditions,
              match: args?.match ?? 'all',
              action: args?.action ?? 'channel_alert',
              cooldown: args?.cooldown ?? 60,
            }),
          })
          if (!res.ok) return error(await res.text())
          return text(await res.text())
        }

        case 'list_watchers': {
          const params = args?.connectionId ? `?connectionId=${args.connectionId}` : ''
          const res = await fetch(`${daemonUrl}/watchers${params}`)
          return text(await res.text())
        }

        case 'get_watcher': {
          const res = await fetch(`${daemonUrl}/watchers/${args?.watcherId}`)
          if (!res.ok) return error('Watcher not found')
          return text(await res.text())
        }

        case 'get_watcher_logs': {
          const res = await fetch(`${daemonUrl}/watchers/${args?.watcherId}/logs?lines=${args?.lines ?? 50}`)
          return text(await res.text())
        }

        case 'update_watcher': {
          const { watcherId, ...updates } = args as any
          const res = await fetch(`${daemonUrl}/watchers/${watcherId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
          })
          if (!res.ok) return error(await res.text())
          return text(await res.text())
        }

        case 'delete_watcher': {
          const res = await fetch(`${daemonUrl}/watchers/${args?.watcherId}`, { method: 'DELETE' })
          if (!res.ok) return error('Watcher not found')
          return text(await res.text())
        }

        case 'restart_watcher': {
          const res = await fetch(`${daemonUrl}/watchers/${args?.watcherId}/restart`, { method: 'POST' })
          if (!res.ok) return error('Watcher not found')
          return text(await res.text())
        }

        case 'status': {
          const res = await fetch(`${daemonUrl}/status`)
          if (!res.ok) return error('Daemon not reachable')
          const status = await res.json()
          // Also fetch watcher count
          let watcherCount = 0
          try {
            const wr = await fetch(`${daemonUrl}/watchers`)
            if (wr.ok) {
              const watchers = await wr.json()
              watcherCount = watchers.length
            }
          } catch { /* ok */ }
          return text(JSON.stringify({ ...status, watcherCount }, null, 2))
        }

        default:
          return error(`Unknown tool: ${name}`)
      }
    } catch (err) {
      // Connection failed — try to auto-start daemon and retry
      const msg = (err as Error).message
      if (msg.includes('Unable to connect') || msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
        const started = await tryStartDaemon(daemonUrl)
        if (!started) {
          return error('livetap daemon could not be started. Run "livetap start" manually.')
        }
        // Retry: simple fetch to /status to confirm, then tell agent to retry
        return text(JSON.stringify({
          note: 'Daemon was restarted. Please retry your request.',
          status: 'daemon_restarted',
        }))
      }
      return error(`livetap daemon error: ${msg}`)
    }
  })
}
