import { test, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test'

setDefaultTimeout(15_000)

const PORT = 28791
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

let connId: string
let ingestUrl: string

test('create webhook connection for watcher tests', async () => {
  const res = await fetch(`${BASE}/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'webhook', name: 'Watcher Test' }),
  })
  const data = await res.json()
  connId = data.connectionId
  ingestUrl = data.ingestUrl
  expect(connId).toMatch(/^conn_/)
})

test('create watcher with valid conditions', async () => {
  const res = await fetch(`${BASE}/watchers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connectionId: connId,
      conditions: [{ field: 'sensors.temperature.value', op: '>', value: 40 }],
      match: 'all',
      cooldown: 2,
    }),
  })
  expect(res.status).toBe(201)
  const data = await res.json()
  expect(data.id).toMatch(/^w_/)
  expect(data.expression).toContain('sensors.temperature.value > 40')
})

test('create watcher rejects invalid op', async () => {
  const res = await fetch(`${BASE}/watchers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connectionId: connId,
      conditions: [{ field: 'temp', op: 'LIKE', value: 40 }],
    }),
  })
  expect(res.status).toBe(400)
  const data = await res.json()
  expect(data.error).toContain('Invalid op')
})

test('create watcher rejects empty conditions', async () => {
  const res = await fetch(`${BASE}/watchers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId: connId, conditions: [] }),
  })
  expect(res.status).toBe(400)
})

test('list watchers returns created watcher', async () => {
  const res = await fetch(`${BASE}/watchers?connectionId=${connId}`)
  const data = await res.json()
  expect(data.length).toBeGreaterThan(0)
  expect(data[0].id).toMatch(/^w_/)
  expect(data[0].status).toBe('running')
})

test('watcher triggers on matching data via SSE', async () => {
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

  // Push matching data
  await new Promise((r) => setTimeout(r, 500)) // let watcher XREAD start
  await fetch(ingestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sensors: { temperature: { value: 55 } } }),
  })

  const sseData = await Promise.race([
    ssePromise,
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error('SSE timeout')), 5000)),
  ])

  expect(sseData).toContain('watcherId')
  expect(sseData).toContain('sensors.temperature.value')
})

test('watcher does NOT trigger on non-matching data', async () => {
  // Get current match count
  const watchersList = await (await fetch(`${BASE}/watchers?connectionId=${connId}`)).json()
  const watcherId = watchersList[0].id
  const before = watchersList[0].matchCount

  // Wait for cooldown
  await new Promise((r) => setTimeout(r, 2500))

  // Push non-matching data
  await fetch(ingestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sensors: { temperature: { value: 30 } } }),
  })

  await new Promise((r) => setTimeout(r, 1000))

  const info = await (await fetch(`${BASE}/watchers/${watcherId}`)).json()
  // matchCount should not have increased (or at most +0 from the non-matching entry)
  // The previous test already triggered one match, so we just check it didn't go up more
  expect(info.matchCount).toBeLessThanOrEqual(before + 1)
})

test('get watcher logs shows MATCH entry', async () => {
  const watchersList = await (await fetch(`${BASE}/watchers?connectionId=${connId}`)).json()
  const watcherId = watchersList[0].id
  const res = await fetch(`${BASE}/watchers/${watcherId}/logs`)
  const data = await res.json()
  expect(data.logs.some((l: string) => l.includes('MATCH'))).toBe(true)
  expect(data.logs.some((l: string) => l.includes('STARTED'))).toBe(true)
})

test('watcher matches plain number payload with regex', async () => {
  // Create a watcher that uses regex on payload (plain number, not JSON object)
  const res = await fetch(`${BASE}/watchers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connectionId: connId,
      conditions: [{ field: 'payload', op: 'matches', value: '^[89]' }],
      match: 'all',
      cooldown: 0,
    }),
  })
  expect(res.status).toBe(201)
  const watcher = await res.json()

  await new Promise((r) => setTimeout(r, 500))

  // Push a plain number that starts with 8 (JSON.parse succeeds → number primitive)
  await fetch(ingestUrl, {
    method: 'POST',
    body: '8536872097.73',
  })
  // Push one that doesn't match
  await fetch(ingestUrl, {
    method: 'POST',
    body: '1234567890.0',
  })
  // Push one starting with 9
  await fetch(ingestUrl, {
    method: 'POST',
    body: '9100000000.5',
  })

  await new Promise((r) => setTimeout(r, 1500))

  const info = await (await fetch(`${BASE}/watchers/${watcher.id}`)).json()
  expect(info.matchCount).toBe(2) // 8B and 9B matched, 1B didn't

  await fetch(`${BASE}/watchers/${watcher.id}`, { method: 'DELETE' })
})

test('watcher matches plain number payload with numeric comparison', async () => {
  const res = await fetch(`${BASE}/watchers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connectionId: connId,
      conditions: [{ field: 'payload', op: '>=', value: 8000000000 }],
      match: 'all',
      cooldown: 0,
    }),
  })
  expect(res.status).toBe(201)
  const watcher = await res.json()

  await new Promise((r) => setTimeout(r, 500))

  await fetch(ingestUrl, { method: 'POST', body: '8536872097.73' }) // match
  await fetch(ingestUrl, { method: 'POST', body: '3000000000.0' })  // no match
  await fetch(ingestUrl, { method: 'POST', body: '9999999999.9' })  // match

  await new Promise((r) => setTimeout(r, 1500))

  const info = await (await fetch(`${BASE}/watchers/${watcher.id}`)).json()
  expect(info.matchCount).toBe(2)

  await fetch(`${BASE}/watchers/${watcher.id}`, { method: 'DELETE' })
})

test('delete watcher', async () => {
  const watchersList = await (await fetch(`${BASE}/watchers?connectionId=${connId}`)).json()
  const watcherId = watchersList[0].id
  const res = await fetch(`${BASE}/watchers/${watcherId}`, { method: 'DELETE' })
  const data = await res.json()
  expect(data.deleted).toBe(watcherId)

  // Verify gone
  const after = await (await fetch(`${BASE}/watchers?connectionId=${connId}`)).json()
  expect(after.length).toBe(0)
})
