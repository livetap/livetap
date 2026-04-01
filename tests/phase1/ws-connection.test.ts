import { test, expect, beforeAll, afterAll } from 'bun:test'
import { StreamStore } from '../../src/server/stream-store.js'
import { ConnectionManager } from '../../src/server/connection-manager.js'
import { createWsServer, type WsTestServer } from '../fixtures/ws-server.js'

let store: StreamStore
let manager: ConnectionManager
let wsServer: WsTestServer

beforeAll(async () => {
  store = new StreamStore()
  manager = new ConnectionManager(store)
  wsServer = createWsServer({ intervalMs: 200 })
})

afterAll(async () => {
  wsServer?.stop()
  await manager?.destroyAll()
  store?.stop()
})

test('create websocket connection → entries in stream', async () => {
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

  const entries = store.range(record.streamKey, 0)
  expect(entries.length).toBeGreaterThan(2)

  // Verify payload has price data from fixture
  const payload = JSON.parse(entries[0].fields.payload)
  expect(payload.symbol).toBe('BTC-USD')
  expect(payload.price).toBeGreaterThan(0)
})
