import { test, expect, beforeAll, afterAll } from 'bun:test'
import { startRedis, type RedisManager } from '../../src/server/redis.js'
import { ConnectionManager } from '../../src/server/connection-manager.js'
import { createWsServer, type WsTestServer } from '../fixtures/ws-server.js'

let redis: RedisManager
let manager: ConnectionManager
let wsServer: WsTestServer

beforeAll(async () => {
  redis = await startRedis()
  manager = new ConnectionManager(redis.client, redis.url)
  wsServer = createWsServer({ intervalMs: 200 })
})

afterAll(async () => {
  wsServer?.stop()
  await manager?.destroyAll()
  await redis?.stop()
})

test('create websocket connection → entries in Redis', async () => {
  const { port } = await wsServer.start()

  const record = await manager.create({
    type: 'websocket',
    url: `ws://127.0.0.1:${port}`,
    pingIntervalMs: 0,
    reconnect: { enabled: false, maxRetries: 0, initialDelayMs: 1000, maxDelayMs: 5000 },
  }, 'Test WS')

  expect(record.id).toMatch(/^conn_[0-9a-f]{8}$/)

  // Wait for messages
  await new Promise((r) => setTimeout(r, 1500))

  const entries = await redis.client.xrange(record.streamKey, '-', '+')
  expect(entries.length).toBeGreaterThan(2)

  // Verify payload has price data from fixture
  const [, fields] = entries[0]
  const payloadIdx = fields.indexOf('payload')
  const payload = JSON.parse(fields[payloadIdx + 1])
  expect(payload.symbol).toBe('BTC-USD')
  expect(payload.price).toBeGreaterThan(0)
})
