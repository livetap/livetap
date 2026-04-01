/**
 * livetap daemon — HTTP API on :8788
 * Manages connections, streams, and watchers.
 */

import { StreamStore } from './stream-store.js'
import { ConnectionManager } from './connection-manager.js'
import { WatcherManager } from './watchers/manager.js'
import type { WatcherAlert } from './watchers/types.js'
import type { StreamEntry } from './types.js'

const PORT = parseInt(process.env.LIVETAP_PORT || '8788')

let store: StreamStore
let manager: ConnectionManager
let watchers: WatcherManager

// SSE clients for alert delivery
const sseClients = new Set<(chunk: string) => void>()

function broadcastSSE(alert: WatcherAlert) {
  const data = `data: ${JSON.stringify(alert)}\n\n`
  for (const emit of sseClients) {
    try { emit(data) } catch { /* client gone */ }
  }
}

async function boot() {
  store = new StreamStore()

  manager = new ConnectionManager(store)
  watchers = new WatcherManager(store, broadcastSSE)

  Bun.serve({
    port: PORT,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url)
      const method = req.method

      // --- SSE events stream ---
      if (method === 'GET' && url.pathname === '/events') {
        const stream = new ReadableStream({
          start(ctrl) {
            const encoder = new TextEncoder()
            ctrl.enqueue(encoder.encode(': connected\n\n'))
            const emit = (chunk: string) => ctrl.enqueue(encoder.encode(chunk))
            sseClients.add(emit)
            req.signal.addEventListener('abort', () => sseClients.delete(emit))
          },
        })
        return new Response(stream, {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        })
      }

      // --- Health ---
      if (method === 'GET' && url.pathname === '/status') {
        return json({
          status: 'running',
          port: PORT,
          connections: manager.list(),
          uptime: process.uptime(),
        })
      }

      // --- Create connection ---
      if (method === 'POST' && url.pathname === '/connections') {
        try {
          const body = await req.json()
          const record = await manager.create(body.config ?? body, body.name)
          return json({
            connectionId: record.id,
            type: record.config.type,
            streamKey: record.streamKey,
            status: 'connected',
            ...(record.config.type === 'webhook' && {
              ingestUrl: `http://127.0.0.1:${PORT}/connections/${record.id}/ingest`,
            }),
          }, 201)
        } catch (err) {
          return json({ error: (err as Error).message }, 400)
        }
      }

      // --- List connections ---
      if (method === 'GET' && url.pathname === '/connections') {
        return json(manager.list())
      }

      // --- Connection routes: /connections/:id ---
      const connMatch = url.pathname.match(/^\/connections\/([^/]+)$/)
      if (connMatch) {
        const id = connMatch[1]
        if (method === 'GET') {
          const status = manager.getStatus(id)
          if (!status) return json({ error: 'Connection not found' }, 404)
          return json(status)
        }
        if (method === 'DELETE') {
          const ok = await manager.destroy(id)
          if (!ok) return json({ error: 'Connection not found' }, 404)
          return json({ deleted: id })
        }
      }

      // --- Webhook ingest: /connections/:id/ingest ---
      const ingestMatch = url.pathname.match(/^\/connections\/([^/]+)\/ingest$/)
      if (ingestMatch && method === 'POST') {
        const id = ingestMatch[1]
        const ingestor = manager.getWebhookIngestor(id)
        if (!ingestor) return json({ error: 'Webhook connection not found' }, 404)
        const body = await req.text()
        await ingestor.ingest(body, Object.fromEntries(req.headers.entries()))
        return json({ ok: true })
      }

      // --- Read stream: /connections/:id/stream ---
      const streamMatch = url.pathname.match(/^\/connections\/([^/]+)\/stream$/)
      if (streamMatch && method === 'GET') {
        const id = streamMatch[1]
        const record = manager.get(id)
        if (!record) return json({ error: 'Connection not found' }, 404)

        const backfillSeconds = parseInt(url.searchParams.get('backfillSeconds') ?? '300')
        const maxEntries = parseInt(url.searchParams.get('maxEntries') ?? '50')

        try {
          const entries = readBackfill(record.streamKey, backfillSeconds, maxEntries)
          return json({ entries, totalEntries: entries.length })
        } catch (err) {
          return json({ error: (err as Error).message }, 500)
        }
      }

      // --- Create watcher ---
      if (method === 'POST' && url.pathname === '/watchers') {
        try {
          const body = await req.json()
          const connId = body.connectionId
          const record = manager.get(connId)
          if (!record) return json({ error: 'Connection not found' }, 404)

          const info = await watchers.create(
            connId,
            record.streamKey,
            body.conditions,
            body.match ?? 'all',
            body.action ?? 'channel_alert',
            body.cooldown ?? 60,
          )
          return json({ id: info.id, status: info.status, expression: `${info.conditions.map(c => `${c.field} ${c.op} ${c.value}`).join(info.match === 'all' ? ' AND ' : ' OR ')}` }, 201)
        } catch (err) {
          return json({ error: (err as Error).message }, 400)
        }
      }

      // --- List watchers ---
      if (method === 'GET' && url.pathname === '/watchers') {
        const connId = url.searchParams.get('connectionId') || undefined
        return json(await watchers.list(connId))
      }

      // --- Watcher routes: /watchers/:id ---
      const watcherMatch = url.pathname.match(/^\/watchers\/([^/]+)$/)
      if (watcherMatch) {
        const id = watcherMatch[1]
        if (method === 'GET') {
          const info = await watchers.get(id)
          if (!info) return json({ error: 'Watcher not found' }, 404)
          return json(info)
        }
        if (method === 'PUT') {
          const body = await req.json()
          const info = await watchers.get(id)
          if (!info) return json({ error: 'Watcher not found' }, 404)
          const record = manager.get(info.connectionId)
          const streamKey = record?.streamKey ?? null
          try {
            const updated = await watchers.update(id, streamKey, body)
            return json(updated)
          } catch (err) {
            return json({ error: (err as Error).message }, 400)
          }
        }
        if (method === 'DELETE') {
          const ok = await watchers.delete(id)
          if (!ok) return json({ error: 'Watcher not found' }, 404)
          return json({ deleted: id })
        }
      }

      // --- Watcher logs: /watchers/:id/logs ---
      const logsMatch = url.pathname.match(/^\/watchers\/([^/]+)\/logs$/)
      if (logsMatch && method === 'GET') {
        const id = logsMatch[1]
        const lines = parseInt(url.searchParams.get('lines') ?? '50')
        const logs = await watchers.getLogs(id, lines)
        return json({ id, logs })
      }

      // --- Restart watcher: /watchers/:id/restart ---
      const restartMatch = url.pathname.match(/^\/watchers\/([^/]+)\/restart$/)
      if (restartMatch && method === 'POST') {
        const id = restartMatch[1]
        const info = await watchers.get(id)
        if (!info) return json({ error: 'Watcher not found' }, 404)
        const record = manager.get(info.connectionId)
        const streamKey = record?.streamKey ?? null
        const ok = await watchers.restart(id, streamKey)
        if (!ok) return json({ error: 'Watcher not found' }, 404)
        return json({ restarted: id })
      }

      return json({ error: 'Not found' }, 404)
    },
  })

  console.error(`[livetap] daemon listening on http://127.0.0.1:${PORT}`)
}

function readBackfill(streamKey: string, backfillSeconds: number, maxEntries: number): StreamEntry[] {
  const sinceMs = Date.now() - backfillSeconds * 1000
  return store.range(streamKey, sinceMs, maxEntries).map((e) => ({
    id: e.id,
    fields: e.fields,
    ts: parseInt(e.id.split('-')[0]),
  }))
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Graceful shutdown
async function shutdown() {
  console.error('[livetap] shutting down...')
  await watchers.stopAll()
  await manager.destroyAll()
  store.stop()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

boot()
