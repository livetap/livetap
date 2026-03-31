import { test, expect, beforeAll, afterAll } from 'bun:test'
import { startRedis, type RedisManager } from '../../src/server/redis.js'
import { ConnectionManager } from '../../src/server/connection-manager.js'
import { createWebhookSender } from '../fixtures/webhook-sender.js'

let redis: RedisManager
let manager: ConnectionManager
const PORT = 28788

let server: ReturnType<typeof Bun.serve>

beforeAll(async () => {
  redis = await startRedis()
  manager = new ConnectionManager(redis.client, redis.url)

  // Start a minimal HTTP server for the ingest route
  server = Bun.serve({
    port: PORT,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url)
      const ingestMatch = url.pathname.match(/^\/connections\/([^/]+)\/ingest$/)
      if (ingestMatch && req.method === 'POST') {
        const id = ingestMatch[1]
        const ingestor = manager.getWebhookIngestor(id)
        if (!ingestor) return new Response('not found', { status: 404 })
        await ingestor.ingest(await req.text(), Object.fromEntries(req.headers.entries()))
        return new Response('ok')
      }
      return new Response('not found', { status: 404 })
    },
  })
})

afterAll(async () => {
  server?.stop()
  await manager?.destroyAll()
  await redis?.stop()
})

test('create webhook connection', async () => {
  const record = await manager.create({ type: 'webhook' }, 'Test Webhook')
  expect(record.id).toMatch(/^conn_[0-9a-f]{8}$/)
  expect(record.config.type).toBe('webhook')
})

test('ingest via webhook sender → entries in Redis', async () => {
  const conns = manager.list()
  const conn = conns[0]
  const ingestUrl = `http://127.0.0.1:${PORT}/connections/${conn.connectionId}/ingest`

  const sender = createWebhookSender({ targetUrl: ingestUrl, intervalMs: 200 })
  await sender.start()

  // Wait for some messages
  await new Promise((r) => setTimeout(r, 1500))
  sender.stop()

  expect(sender.sentCount).toBeGreaterThan(3)

  // Verify entries in Redis
  const record = manager.get(conn.connectionId)!
  const entries = await redis.client.xrange(record.streamKey, '-', '+')
  expect(entries.length).toBeGreaterThan(3)

  // Verify payload is JSON
  const [, fields] = entries[0]
  const payloadIdx = fields.indexOf('payload')
  const payload = JSON.parse(fields[payloadIdx + 1])
  expect(payload.metadata.device_name).toMatch(/^sensor-zone-/)
})
