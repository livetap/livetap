import { test, expect, afterAll } from 'bun:test'
import { startRedis, type RedisManager } from '../../src/server/redis.js'

let redis: RedisManager

afterAll(async () => {
  if (redis) await redis.stop()
})

test('boots embedded redis on random port', async () => {
  redis = await startRedis()
  expect(redis.port).toBeGreaterThan(0)
  expect(redis.url).toContain(String(redis.port))
})

test('ping returns PONG', async () => {
  const result = await redis.client.ping()
  expect(result).toBe('PONG')
})

test('XADD and XRANGE work', async () => {
  const key = `test:redis:stream:${Date.now()}`
  await redis.client.xadd(key, '*', 'key', 'value')
  const entries = await redis.client.xrange(key, '-', '+')
  expect(entries.length).toBe(1)
  expect(entries[0][1]).toContain('key')
  expect(entries[0][1]).toContain('value')
})

test('XTRIM removes old entries', async () => {
  const key = 'test:redis:trim'
  // Add entries
  for (let i = 0; i < 5; i++) {
    await redis.client.xadd(key, '*', 'i', String(i))
  }
  const before = await redis.client.xlen(key)
  expect(before).toBe(5)

  // Trim to future MINID (removes all)
  const futureId = (Date.now() + 60000).toString()
  await redis.client.xtrim(key, 'MINID', '~', futureId)
  const after = await redis.client.xlen(key)
  expect(after).toBe(0)
})
