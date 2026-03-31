/**
 * livetap daemon — HTTP API on :8788
 * Manages connections, streams, and (later) watchers.
 */

import { startRedis, type RedisManager } from './redis.js'
import { ConnectionManager } from './connection-manager.js'
import type { StreamEntry } from './types.js'

const PORT = parseInt(process.env.LIVETAP_PORT || '8788')

let redis: RedisManager
let manager: ConnectionManager

async function boot() {
  redis = await startRedis()
  console.error(`[livetap] Redis started on port ${redis.port}`)

  manager = new ConnectionManager(redis.client, redis.url)

  Bun.serve({
    port: PORT,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url)
      const method = req.method

      // --- Health ---
      if (method === 'GET' && url.pathname === '/status') {
        return json({
          status: 'running',
          port: PORT,
          redisPort: redis.port,
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
          const entries = await readBackfill(record.streamKey, backfillSeconds, maxEntries)
          return json({ entries, totalEntries: entries.length })
        } catch (err) {
          return json({ error: (err as Error).message }, 500)
        }
      }

      return json({ error: 'Not found' }, 404)
    },
  })

  console.error(`[livetap] daemon listening on http://127.0.0.1:${PORT}`)
}

async function readBackfill(streamKey: string, backfillSeconds: number, maxEntries: number): Promise<StreamEntry[]> {
  const since = (Date.now() - backfillSeconds * 1000).toString()
  const raw = await redis.client.xrange(streamKey, since, '+', 'COUNT', maxEntries)
  return raw.map(([id, fieldArray]) => {
    const fields: Record<string, string> = {}
    for (let i = 0; i < fieldArray.length; i += 2) {
      fields[fieldArray[i]] = fieldArray[i + 1]
    }
    return { id, fields, ts: parseInt(id.split('-')[0]) }
  })
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.error('[livetap] shutting down...')
  await manager.destroyAll()
  await redis.stop()
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.error('[livetap] shutting down...')
  await manager.destroyAll()
  await redis.stop()
  process.exit(0)
})

boot()
