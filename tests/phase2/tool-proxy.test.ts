import { test, expect, beforeAll, afterAll } from 'bun:test'

/**
 * Tests MCP tool proxy by starting the daemon and calling tools
 * through the HTTP API (same endpoints the MCP proxy hits).
 */

const PORT = 18790
let serverProc: ReturnType<typeof Bun.spawn>

beforeAll(async () => {
  serverProc = Bun.spawn(['bun', 'src/server/index.ts'], {
    env: { ...process.env, LIVETAP_PORT: String(PORT) },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/status`)
      if (res.ok) break
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500))
  }
})

afterAll(() => {
  serverProc?.kill()
})

const BASE = `http://127.0.0.1:${PORT}`

test('create_connection (webhook) via HTTP', async () => {
  const res = await fetch(`${BASE}/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'webhook', name: 'Proxy Test' }),
  })
  expect(res.status).toBe(201)
  const data = await res.json()
  expect(data.connectionId).toMatch(/^conn_/)
  expect(data.type).toBe('webhook')
})

test('list_connections via HTTP', async () => {
  const res = await fetch(`${BASE}/connections`)
  const data = await res.json()
  expect(data.length).toBeGreaterThan(0)
})

test('get_connection via HTTP', async () => {
  const list = await (await fetch(`${BASE}/connections`)).json()
  const id = list[0].connectionId
  const res = await fetch(`${BASE}/connections/${id}`)
  const data = await res.json()
  expect(data.connectionId).toBe(id)
  expect(data.runtimeState).toBe('connected')
})

test('read_stream via HTTP', async () => {
  const list = await (await fetch(`${BASE}/connections`)).json()
  const id = list[0].connectionId

  // Ingest a message first
  await fetch(`${BASE}/connections/${id}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ test: true }),
  })

  const res = await fetch(`${BASE}/connections/${id}/stream?maxEntries=5`)
  const data = await res.json()
  expect(data.entries.length).toBeGreaterThan(0)
})

test('destroy_connection via HTTP', async () => {
  const list = await (await fetch(`${BASE}/connections`)).json()
  const id = list[0].connectionId
  const res = await fetch(`${BASE}/connections/${id}`, { method: 'DELETE' })
  const data = await res.json()
  expect(data.deleted).toBe(id)
})

test('get_connection returns 404 for unknown', async () => {
  const res = await fetch(`${BASE}/connections/conn_nonexistent`)
  expect(res.status).toBe(404)
})
