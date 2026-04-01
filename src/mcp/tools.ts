/**
 * MCP Tool definitions for livetap.
 * Registers tools on an MCP Server that proxy to the daemon HTTP API.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

export { TOOLS } from '../shared/canonical/tools.js'
import { TOOLS } from '../shared/canonical/tools.js'

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
