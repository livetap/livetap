import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import { startRedis, type RedisManager } from '../../src/server/redis.js'
import { ConnectionManager } from '../../src/server/connection-manager.js'
import { writeFileSync, appendFileSync, mkdirSync, rmSync } from 'fs'
import { resolve } from 'path'

const TMP = resolve(import.meta.dir, '..', '..', '.tmp-file-test')
let redis: RedisManager
let manager: ConnectionManager

beforeAll(async () => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
  redis = await startRedis()
  manager = new ConnectionManager(redis.client, redis.url)
})

afterAll(async () => {
  await manager?.destroyAll()
  await redis?.stop()
  rmSync(TMP, { recursive: true, force: true })
})

test('tails new plain text lines into Redis', async () => {
  const logFile = resolve(TMP, 'app.log')
  writeFileSync(logFile, '') // create empty file

  const record = await manager.create({ type: 'file', path: logFile })
  expect(record.id).toMatch(/^conn_/)

  // Wait for subscriber to start
  await new Promise((r) => setTimeout(r, 500))

  // Append lines
  appendFileSync(logFile, 'first log line\n')
  appendFileSync(logFile, 'second log line\n')
  appendFileSync(logFile, 'third log line\n')

  // Wait for poll to pick up
  await new Promise((r) => setTimeout(r, 2000))

  const entries = await redis.client.xrange(record.streamKey, '-', '+')
  expect(entries.length).toBeGreaterThanOrEqual(3)

  // Verify format=text
  const [, fields] = entries[0]
  const fmtIdx = fields.indexOf('format')
  expect(fields[fmtIdx + 1]).toBe('text')

  const payIdx = fields.indexOf('payload')
  expect(fields[payIdx + 1]).toBe('first log line')

  await manager.destroy(record.id)
})

test('tails JSON lines with format=json', async () => {
  const logFile = resolve(TMP, 'structured.log')
  writeFileSync(logFile, '')

  const record = await manager.create({ type: 'file', path: logFile })
  await new Promise((r) => setTimeout(r, 500))

  appendFileSync(logFile, JSON.stringify({ level: 'ERROR', msg: 'disk full', code: 500 }) + '\n')
  appendFileSync(logFile, JSON.stringify({ level: 'INFO', msg: 'recovered', code: 200 }) + '\n')

  await new Promise((r) => setTimeout(r, 2000))

  const entries = await redis.client.xrange(record.streamKey, '-', '+')
  expect(entries.length).toBeGreaterThanOrEqual(2)

  // First entry should be JSON format
  const [, fields] = entries[0]
  const fmtIdx = fields.indexOf('format')
  expect(fields[fmtIdx + 1]).toBe('json')

  const payIdx = fields.indexOf('payload')
  const parsed = JSON.parse(fields[payIdx + 1])
  expect(parsed.level).toBe('ERROR')
  expect(parsed.msg).toBe('disk full')

  await manager.destroy(record.id)
})

test('ignores existing content (tail -f behavior)', async () => {
  const logFile = resolve(TMP, 'existing.log')
  writeFileSync(logFile, 'old line 1\nold line 2\nold line 3\n')

  const record = await manager.create({ type: 'file', path: logFile })
  await new Promise((r) => setTimeout(r, 1500))

  // Should have NO entries (old content ignored)
  const entries = await redis.client.xrange(record.streamKey, '-', '+')
  expect(entries.length).toBe(0)

  // Now append new content
  appendFileSync(logFile, 'new line after tap\n')
  await new Promise((r) => setTimeout(r, 2000))

  const after = await redis.client.xrange(record.streamKey, '-', '+')
  expect(after.length).toBeGreaterThanOrEqual(1)

  const [, fields] = after[0]
  const payIdx = fields.indexOf('payload')
  expect(fields[payIdx + 1]).toBe('new line after tap')

  await manager.destroy(record.id)
})

test('skips empty lines', async () => {
  const logFile = resolve(TMP, 'sparse.log')
  writeFileSync(logFile, '')

  const record = await manager.create({ type: 'file', path: logFile })
  await new Promise((r) => setTimeout(r, 500))

  appendFileSync(logFile, 'real line\n\n\n\nanother real line\n')
  await new Promise((r) => setTimeout(r, 2000))

  const entries = await redis.client.xrange(record.streamKey, '-', '+')
  expect(entries.length).toBe(2) // only 2 non-empty lines

  await manager.destroy(record.id)
})

test('watcher with regex matches text log lines', async () => {
  const logFile = resolve(TMP, 'errors.log')
  writeFileSync(logFile, '')

  const record = await manager.create({ type: 'file', path: logFile })
  await new Promise((r) => setTimeout(r, 500))

  // This test just verifies the data flows and format is correct for watchers
  appendFileSync(logFile, '2026-03-31 [INFO] All systems nominal\n')
  appendFileSync(logFile, '2026-03-31 [ERROR] Connection refused to db:5432\n')
  appendFileSync(logFile, '2026-03-31 [WARN] High memory usage 89%\n')

  await new Promise((r) => setTimeout(r, 2000))

  const entries = await redis.client.xrange(record.streamKey, '-', '+')
  expect(entries.length).toBeGreaterThanOrEqual(3)

  // Verify the ERROR line is there and matchable by regex
  const payloads = entries.map(([, f]) => f[f.indexOf('payload') + 1])
  expect(payloads.some((p) => /\[ERROR\]/.test(p))).toBe(true)
  expect(payloads.some((p) => /\[INFO\]/.test(p))).toBe(true)

  await manager.destroy(record.id)
})

test('fails gracefully on non-existent file', async () => {
  try {
    await manager.create({ type: 'file', path: '/tmp/nonexistent-livetap-test.log' })
    expect(true).toBe(false) // should not reach
  } catch (err) {
    expect((err as Error).message).toContain('no such file')
  }
})
