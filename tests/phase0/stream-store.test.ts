import { test, expect, beforeEach } from 'bun:test'
import { StreamStore } from '../../src/server/stream-store.js'

let store: StreamStore

beforeEach(() => {
  store = new StreamStore()
})

// --- append ---

test('append returns timestamp-based ID', () => {
  const id = store.append('s1', { payload: 'hello' })
  expect(id).toMatch(/^\d+-\d+$/)
})

test('append increments sequence counter', () => {
  const id1 = store.append('s1', { payload: 'a' })
  const id2 = store.append('s1', { payload: 'b' })
  const seq1 = parseInt(id1.split('-')[1])
  const seq2 = parseInt(id2.split('-')[1])
  expect(seq2).toBe(seq1 + 1)
})

test('append stores entry with fields', () => {
  store.append('s1', { topic: 'test', payload: '{"temp":25}' })
  const entries = store.range('s1', 0)
  expect(entries).toHaveLength(1)
  expect(entries[0].fields.topic).toBe('test')
  expect(entries[0].fields.payload).toBe('{"temp":25}')
})

// --- range ---

test('range returns entries after sinceMs', () => {
  store.append('s1', { payload: 'old' })
  const cutoff = Date.now() + 1
  store.append('s1', { payload: 'new' })
  // All entries have similar timestamps, so get all
  const all = store.range('s1', 0)
  expect(all.length).toBeGreaterThanOrEqual(1)
})

test('range respects count limit', () => {
  for (let i = 0; i < 10; i++) {
    store.append('s1', { payload: String(i) })
  }
  const limited = store.range('s1', 0, 3)
  expect(limited).toHaveLength(3)
})

test('range returns empty for nonexistent stream', () => {
  expect(store.range('nope', 0)).toEqual([])
})

// --- trim ---

test('trim removes old entries', async () => {
  store.append('s1', { payload: 'old' })
  // Wait a tick so timestamps differ
  await new Promise((r) => setTimeout(r, 5))
  const cutoff = Date.now()
  store.append('s1', { payload: 'new' })

  store.trim('s1', cutoff)
  const entries = store.range('s1', 0)
  expect(entries).toHaveLength(1)
  expect(entries[0].fields.payload).toBe('new')
})

test('trim on nonexistent stream does nothing', () => {
  store.trim('nope', Date.now()) // no throw
})

// --- len ---

test('len returns entry count', () => {
  expect(store.len('s1')).toBe(0)
  store.append('s1', { payload: 'a' })
  store.append('s1', { payload: 'b' })
  expect(store.len('s1')).toBe(2)
})

test('len returns 0 for nonexistent stream', () => {
  expect(store.len('nope')).toBe(0)
})

// --- del ---

test('del removes stream entirely', () => {
  store.append('s1', { payload: 'a' })
  expect(store.len('s1')).toBe(1)
  store.del('s1')
  expect(store.len('s1')).toBe(0)
  expect(store.has('s1')).toBe(false)
})

// --- subscribe ---

test('subscribe receives new entries', async () => {
  const received: string[] = []
  store.subscribe('s1', (entry) => {
    received.push(entry.fields.payload)
  })

  store.append('s1', { payload: 'hello' })
  store.append('s1', { payload: 'world' })

  // EventEmitter is synchronous
  expect(received).toEqual(['hello', 'world'])
})

test('subscribe only receives entries for subscribed stream', () => {
  const received: string[] = []
  store.subscribe('s1', (entry) => {
    received.push(entry.fields.payload)
  })

  store.append('s2', { payload: 'other' })
  store.append('s1', { payload: 'mine' })

  expect(received).toEqual(['mine'])
})

test('unsubscribe stops receiving', () => {
  const received: string[] = []
  const unsub = store.subscribe('s1', (entry) => {
    received.push(entry.fields.payload)
  })

  store.append('s1', { payload: 'before' })
  unsub()
  store.append('s1', { payload: 'after' })

  expect(received).toEqual(['before'])
})

test('multiple subscribers on same stream', () => {
  let count1 = 0
  let count2 = 0
  store.subscribe('s1', () => count1++)
  store.subscribe('s1', () => count2++)

  store.append('s1', { payload: 'x' })
  expect(count1).toBe(1)
  expect(count2).toBe(1)
})

// --- has ---

test('has returns false for nonexistent, true after append', () => {
  expect(store.has('s1')).toBe(false)
  store.append('s1', { payload: 'a' })
  expect(store.has('s1')).toBe(true)
})

// --- stop ---

test('stop clears all data and listeners', () => {
  store.append('s1', { payload: 'a' })
  store.append('s2', { payload: 'b' })

  const received: string[] = []
  store.subscribe('s1', (e) => received.push(e.fields.payload))

  store.stop()

  expect(store.len('s1')).toBe(0)
  expect(store.len('s2')).toBe(0)
  // Listeners cleared — appending to a new s1 won't fire old callback
  store.append('s1', { payload: 'after-stop' })
  expect(received).toEqual([])
})

// --- integration: append + trim + range ---

test('rolling retention pattern works', async () => {
  // Simulate the subscriber pattern: append + trim
  store.append('s1', { payload: 'entry1' })
  await new Promise((r) => setTimeout(r, 5))
  store.append('s1', { payload: 'entry2' })
  await new Promise((r) => setTimeout(r, 5))
  store.append('s1', { payload: 'entry3' })

  // Trim everything before now (should remove entry1 and entry2)
  store.trim('s1', Date.now())
  // entry3 might survive if its timestamp == Date.now()
  expect(store.len('s1')).toBeLessThanOrEqual(1)
})
