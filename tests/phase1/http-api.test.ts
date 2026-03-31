import { test, expect, beforeAll, afterAll } from 'bun:test'

const PORT = 28789
let serverProc: ReturnType<typeof Bun.spawn>

beforeAll(async () => {
  serverProc = Bun.spawn(['bun', 'src/server/index.ts'], {
    env: { ...process.env, LIVETAP_PORT: String(PORT) },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  // Wait for server to be ready
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

test('GET /status returns running', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/status`)
  const data = await res.json()
  expect(data.status).toBe('running')
  expect(data.connections).toBeArray()
})

test('POST /connections creates webhook', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'webhook', name: 'API Test' }),
  })
  expect(res.status).toBe(201)
  const data = await res.json()
  expect(data.connectionId).toMatch(/^conn_/)
  expect(data.ingestUrl).toContain('/ingest')
})

test('GET /connections lists connections', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/connections`)
  const data = await res.json()
  expect(data.length).toBeGreaterThan(0)
  expect(data[0].connectionId).toMatch(/^conn_/)
})

test('POST ingest → GET stream returns entries', async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/connections`)).json()
  const connId = list[0].connectionId

  // Ingest
  await fetch(`http://127.0.0.1:${PORT}/connections/${connId}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ temp: 42, sensor: 'zone-a' }),
  })

  // Read stream
  const res = await fetch(`http://127.0.0.1:${PORT}/connections/${connId}/stream`)
  const data = await res.json()
  expect(data.entries.length).toBeGreaterThan(0)
  expect(data.entries[0].fields.payload).toContain('temp')
})

test('DELETE /connections/:id removes connection', async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/connections`)).json()
  const connId = list[0].connectionId

  const res = await fetch(`http://127.0.0.1:${PORT}/connections/${connId}`, { method: 'DELETE' })
  const data = await res.json()
  expect(data.deleted).toBe(connId)

  // Verify gone
  const after = await (await fetch(`http://127.0.0.1:${PORT}/connections`)).json()
  expect(after.length).toBe(0)
})

test('GET /connections/:id returns 404 for unknown', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/connections/conn_nonexistent`)
  expect(res.status).toBe(404)
})
