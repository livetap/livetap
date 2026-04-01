import { test, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test'
import { StreamStore } from '../../src/server/stream-store.js'
import { ConnectionManager } from '../../src/server/connection-manager.js'
import { createWsServer, type WsTestServer } from '../fixtures/ws-server.js'

setDefaultTimeout(15_000)

let store: StreamStore
let manager: ConnectionManager

beforeAll(async () => {
  store = new StreamStore()
  manager = new ConnectionManager(store)
})

afterAll(async () => {
  await manager?.destroyAll()
  store?.stop()
})

test('basic JSON text messages flow to stream', async () => {
  const ws = createWsServer({ intervalMs: 200 })
  const { port } = await ws.start()

  const record = await manager.create({
    type: 'websocket',
    url: `ws://127.0.0.1:${port}`,
    pingIntervalMs: 0,
    reconnect: { enabled: false, maxRetries: 0, initialDelayMs: 1000, maxDelayMs: 5000 },
  })

  await new Promise((r) => setTimeout(r, 1500))

  const entries = store.range(record.streamKey, 0)
  expect(entries.length).toBeGreaterThan(2)

  // Verify format=json
  expect(entries[0].fields.format).toBe('json')

  // Verify payload is valid JSON with price
  const payload = JSON.parse(entries[0].fields.payload)
  expect(payload.symbol).toBe('BTC-USD')
  expect(payload.price).toBeGreaterThan(0)

  ws.stop()
  await manager.destroy(record.id)
})

test('binary frames stored correctly', async () => {
  const ws = createWsServer({ intervalMs: 200, sendBinary: true })
  const { port } = await ws.start()

  const record = await manager.create({
    type: 'websocket',
    url: `ws://127.0.0.1:${port}`,
    pingIntervalMs: 0,
    binaryFormat: 'json',
    reconnect: { enabled: false, maxRetries: 0, initialDelayMs: 1000, maxDelayMs: 5000 },
  })

  await new Promise((r) => setTimeout(r, 1500))

  const entries = store.range(record.streamKey, 0)
  expect(entries.length).toBeGreaterThan(0)

  // With binaryFormat='json', binary frames containing valid JSON should be parsed
  const payload = JSON.parse(entries[0].fields.payload)
  expect(payload.symbol).toBe('BTC-USD')

  ws.stop()
  await manager.destroy(record.id)
})

test('reconnects after server drops connection', async () => {
  const ws = createWsServer({ intervalMs: 200, dropAfter: 3 })
  const { port } = await ws.start()

  const record = await manager.create({
    type: 'websocket',
    url: `ws://127.0.0.1:${port}`,
    pingIntervalMs: 0,
    reconnect: { enabled: true, maxRetries: 5, initialDelayMs: 500, maxDelayMs: 2000 },
  })

  // Wait for initial messages + drop + reconnect + more messages
  await new Promise((r) => setTimeout(r, 5000))

  const entries = store.range(record.streamKey, 0)
  // Should have messages from first connection (3) + reconnected connection
  expect(entries.length).toBeGreaterThan(3)
  expect(ws.connectionCount).toBeGreaterThan(1)

  ws.stop()
  await manager.destroy(record.id)
})

test('handshake message sent on connect', async () => {
  const handshake = '{"subscribe":"BTC-USD"}'
  const ws = createWsServer({ intervalMs: 200, requireHandshake: handshake })
  const { port } = await ws.start()

  const record = await manager.create({
    type: 'websocket',
    url: `ws://127.0.0.1:${port}`,
    handshake,
    pingIntervalMs: 0,
    reconnect: { enabled: false, maxRetries: 0, initialDelayMs: 1000, maxDelayMs: 5000 },
  })

  await new Promise((r) => setTimeout(r, 2000))

  const entries = store.range(record.streamKey, 0)
  // First entry should be the subscription confirmation
  expect(entries.length).toBeGreaterThan(0)

  // Should also have price data (server only sends after handshake)
  const lastEntry = entries[entries.length - 1]
  const payload = JSON.parse(lastEntry.fields.payload)
  expect(payload.price || payload.status).toBeTruthy()

  ws.stop()
  await manager.destroy(record.id)
})

test('max retries exhausted sets error state', async () => {
  // Server rejects all connections
  const ws = createWsServer({ intervalMs: 200, rejectConnections: 100 })
  const { port } = await ws.start()

  const record = await manager.create({
    type: 'websocket',
    url: `ws://127.0.0.1:${port}`,
    pingIntervalMs: 0,
    reconnect: { enabled: true, maxRetries: 2, initialDelayMs: 300, maxDelayMs: 500 },
  })

  // Wait for retries to exhaust
  await new Promise((r) => setTimeout(r, 4000))

  const status = record.subscriber.getStatus()
  expect(status.runtimeState).toBe('error')
  expect(status.error).toContain('Max retries')

  ws.stop()
  await manager.destroy(record.id)
})

test('connection status tracks state correctly', async () => {
  const ws = createWsServer({ intervalMs: 200 })
  const { port } = await ws.start()

  const record = await manager.create({
    type: 'websocket',
    url: `ws://127.0.0.1:${port}`,
    pingIntervalMs: 0,
    reconnect: { enabled: true, maxRetries: 3, initialDelayMs: 500, maxDelayMs: 2000 },
  })

  // Should be connected after a moment
  await new Promise((r) => setTimeout(r, 500))
  expect(record.subscriber.getStatus().runtimeState).toBe('connected')

  // Drop connection
  ws.dropConnection()
  await new Promise((r) => setTimeout(r, 300))
  const status = record.subscriber.getStatus()
  expect(['reconnecting', 'disconnected', 'error']).toContain(status.runtimeState)

  // Wait for reconnect
  await new Promise((r) => setTimeout(r, 2000))
  expect(record.subscriber.getStatus().runtimeState).toBe('connected')

  // Stop
  await record.subscriber.stop()
  expect(record.subscriber.getStatus().runtimeState).toBe('disconnected')

  ws.stop()
  await manager.destroy(record.id)
})
