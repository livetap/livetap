import { test, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test'
import { writeFileSync, appendFileSync, mkdirSync, rmSync } from 'fs'
import { resolve } from 'path'

setDefaultTimeout(15_000)

const TMP = resolve(import.meta.dir, '..', '..', '.tmp-file-watcher-test')
const PORT = 28795
let serverProc: ReturnType<typeof Bun.spawn>
const BASE = `http://127.0.0.1:${PORT}`

beforeAll(async () => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })

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
  rmSync(TMP, { recursive: true, force: true })
})

test('plain text file + contains watcher fires alert via SSE', async () => {
  const logFile = resolve(TMP, 'app.log')
  writeFileSync(logFile, '')

  // Create file connection
  const connRes = await fetch(`${BASE}/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'file', path: logFile }),
  })
  const conn = await connRes.json()

  // Create watcher with contains on payload
  const watchRes = await fetch(`${BASE}/watchers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connectionId: conn.connectionId,
      conditions: [{ field: 'payload', op: 'contains', value: 'ERROR' }],
      cooldown: 0,
    }),
  })
  expect(watchRes.status).toBe(201)
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

  await new Promise((r) => setTimeout(r, 1000))

  // Write non-matching then matching lines
  appendFileSync(logFile, '2026-03-31 [INFO] Server started\n')
  appendFileSync(logFile, '2026-03-31 [ERROR] Connection refused to db:5432\n')

  const sseData = await Promise.race([
    ssePromise,
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error('SSE timeout')), 8000)),
  ])

  expect(sseData).toContain(watcher.id)
  expect(sseData).toContain('watcherId')

  // Cleanup
  await fetch(`${BASE}/watchers/${watcher.id}`, { method: 'DELETE' })
  await fetch(`${BASE}/connections/${conn.connectionId}`, { method: 'DELETE' })
})

test('plain text file + regex matches watcher fires alert via SSE', async () => {
  const logFile = resolve(TMP, 'nginx.log')
  writeFileSync(logFile, '')

  // Create file connection
  const connRes = await fetch(`${BASE}/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'file', path: logFile }),
  })
  const conn = await connRes.json()

  // Create watcher with regex on payload for 5xx status codes
  const watchRes = await fetch(`${BASE}/watchers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connectionId: conn.connectionId,
      conditions: [{ field: 'payload', op: 'matches', value: '5[0-9]{2}' }],
      cooldown: 0,
    }),
  })
  expect(watchRes.status).toBe(201)
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

  await new Promise((r) => setTimeout(r, 1000))

  // Write log lines — 200 shouldn't match, 503 should
  appendFileSync(logFile, '10.0.0.1 - GET /api/health 200 12ms\n')
  appendFileSync(logFile, '10.0.0.1 - GET /api/data 503 timeout\n')

  const sseData = await Promise.race([
    ssePromise,
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error('SSE timeout')), 8000)),
  ])

  expect(sseData).toContain(watcher.id)

  // Cleanup
  await fetch(`${BASE}/watchers/${watcher.id}`, { method: 'DELETE' })
  await fetch(`${BASE}/connections/${conn.connectionId}`, { method: 'DELETE' })
})

test('JSON log lines + dot-path watcher fires correctly', async () => {
  const logFile = resolve(TMP, 'structured.log')
  writeFileSync(logFile, '')

  const connRes = await fetch(`${BASE}/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'file', path: logFile }),
  })
  const conn = await connRes.json()

  // Watch for level == "ERROR" inside JSON log lines
  const watchRes = await fetch(`${BASE}/watchers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connectionId: conn.connectionId,
      conditions: [{ field: 'level', op: '==', value: 'ERROR' }],
      cooldown: 0,
    }),
  })
  expect(watchRes.status).toBe(201)
  const watcher = await watchRes.json()

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

  await new Promise((r) => setTimeout(r, 1000))

  // INFO line shouldn't trigger, ERROR should
  appendFileSync(logFile, JSON.stringify({ level: 'INFO', msg: 'all good' }) + '\n')
  appendFileSync(logFile, JSON.stringify({ level: 'ERROR', msg: 'db connection failed' }) + '\n')

  const sseData = await Promise.race([
    ssePromise,
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error('SSE timeout')), 8000)),
  ])

  expect(sseData).toContain(watcher.id)

  await fetch(`${BASE}/watchers/${watcher.id}`, { method: 'DELETE' })
  await fetch(`${BASE}/connections/${conn.connectionId}`, { method: 'DELETE' })
})
