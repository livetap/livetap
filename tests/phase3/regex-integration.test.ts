import { test, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test'

setDefaultTimeout(15_000)

const PORT = 28794
let serverProc: ReturnType<typeof Bun.spawn>
const BASE = `http://127.0.0.1:${PORT}`

beforeAll(async () => {
  serverProc = Bun.spawn(['bun', 'src/server/index.ts'], {
    env: { ...process.env, LIVETAP_PORT: String(PORT) },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BASE}/status`)
      if (res.ok) break
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500))
  }
})

afterAll(() => {
  serverProc?.kill()
})

test('regex watcher validates pattern on create', async () => {
  // Create webhook connection
  const connRes = await fetch(`${BASE}/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'webhook' }),
  })
  const conn = await connRes.json()

  // Valid regex should succeed
  const validRes = await fetch(`${BASE}/watchers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connectionId: conn.connectionId,
      conditions: [{ field: 'payload', op: 'matches', value: 'ERROR|FATAL' }],
      cooldown: 2,
    }),
  })
  expect(validRes.status).toBe(201)
  const watcher = await validRes.json()

  // Invalid regex should fail with 400
  const invalidRes = await fetch(`${BASE}/watchers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connectionId: conn.connectionId,
      conditions: [{ field: 'payload', op: 'matches', value: '[invalid' }],
    }),
  })
  expect(invalidRes.status).toBe(400)
  const err = await invalidRes.json()
  expect(err.error).toContain('Invalid regex')

  // Cleanup
  await fetch(`${BASE}/watchers/${watcher.id}`, { method: 'DELETE' })
  await fetch(`${BASE}/connections/${conn.connectionId}`, { method: 'DELETE' })
})

test('regex watcher fires on matching log-like data', async () => {
  // Create webhook connection
  const connRes = await fetch(`${BASE}/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'webhook' }),
  })
  const conn = await connRes.json()

  // Create watcher with regex for 5xx errors
  const watchRes = await fetch(`${BASE}/watchers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connectionId: conn.connectionId,
      conditions: [{ field: 'status', op: 'matches', value: '5[0-9]{2}' }],
      cooldown: 2,
    }),
  })
  const watcher = await watchRes.json()

  // Start SSE listener
  const ssePromise = new Promise<string>(async (resolve) => {
    const res = await fetch(`${BASE}/events`)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      if (buf.includes('"watcherId"')) {
        reader.cancel()
        resolve(buf)
        break
      }
    }
  })

  await new Promise((r) => setTimeout(r, 500))

  // Push non-matching data (200 status)
  await fetch(`${BASE}/connections/${conn.connectionId}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: '200', path: '/api/health' }),
  })

  // Push matching data (503 status)
  await fetch(`${BASE}/connections/${conn.connectionId}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: '503', path: '/api/data', error: 'service unavailable' }),
  })

  const sseData = await Promise.race([
    ssePromise,
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error('SSE timeout')), 5000)),
  ])

  expect(sseData).toContain('watcherId')
  expect(sseData).toContain(watcher.id)

  // Cleanup
  await fetch(`${BASE}/watchers/${watcher.id}`, { method: 'DELETE' })
  await fetch(`${BASE}/connections/${conn.connectionId}`, { method: 'DELETE' })
})
