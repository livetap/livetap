import { test, expect } from 'bun:test'
import { resolveDotPath, evaluateCondition, evaluateWatcher } from '../../src/server/watchers/engine.js'

const payload = {
  sensors: {
    environmental: {
      temperature: { value: 42.5, unit: '°C' },
      humidity: { value: 85, unit: '%' },
    },
    air_quality: { smoke: { value: 0.03, unit: 'ppm' } },
  },
  device: 'sensor-zone-a',
  alert: 'OVERHEATING',
}

// --- resolveDotPath ---
test('resolves nested dot path', () => {
  expect(resolveDotPath(payload, 'sensors.environmental.temperature.value')).toBe(42.5)
})

test('resolves top-level field', () => {
  expect(resolveDotPath(payload, 'device')).toBe('sensor-zone-a')
})

test('returns undefined for missing path', () => {
  expect(resolveDotPath(payload, 'sensors.foo.bar')).toBeUndefined()
})

test('resolves literal dotted key (OBIS codes like 2.8.0)', () => {
  const obis = { '1.8.0': '26316339', '2.8.0': '18919769', '32.7.0': '231.40', timestamp: '2026-04-01' }
  expect(resolveDotPath(obis, '2.8.0')).toBe('18919769')
  expect(resolveDotPath(obis, '32.7.0')).toBe('231.40')
  expect(resolveDotPath(obis, 'timestamp')).toBe('2026-04-01')
})

test('literal key takes priority over dot-path traversal', () => {
  // Object has both a literal "a.b" key and a nested a.b path
  const obj = { 'a.b': 'literal', a: { b: 'nested' } }
  expect(resolveDotPath(obj, 'a.b')).toBe('literal')
})

test('returns undefined for empty object', () => {
  expect(resolveDotPath({}, 'a.b.c')).toBeUndefined()
})

// --- evaluateCondition ---
test('> operator', () => {
  expect(evaluateCondition(payload, { field: 'sensors.environmental.temperature.value', op: '>', value: 40 })).toBe(true)
  expect(evaluateCondition(payload, { field: 'sensors.environmental.temperature.value', op: '>', value: 50 })).toBe(false)
})

test('< operator', () => {
  expect(evaluateCondition(payload, { field: 'sensors.environmental.temperature.value', op: '<', value: 50 })).toBe(true)
})

test('>= operator', () => {
  expect(evaluateCondition(payload, { field: 'sensors.environmental.temperature.value', op: '>=', value: 42.5 })).toBe(true)
})

test('<= operator', () => {
  expect(evaluateCondition(payload, { field: 'sensors.environmental.humidity.value', op: '<=', value: 85 })).toBe(true)
})

test('== operator', () => {
  expect(evaluateCondition(payload, { field: 'device', op: '==', value: 'sensor-zone-a' })).toBe(true)
  expect(evaluateCondition(payload, { field: 'device', op: '==', value: 'sensor-zone-b' })).toBe(false)
})

test('!= operator', () => {
  expect(evaluateCondition(payload, { field: 'device', op: '!=', value: 'sensor-zone-b' })).toBe(true)
})

test('contains operator', () => {
  expect(evaluateCondition(payload, { field: 'alert', op: 'contains', value: 'HEAT' })).toBe(true)
  expect(evaluateCondition(payload, { field: 'alert', op: 'contains', value: 'COLD' })).toBe(false)
})

test('missing field returns false', () => {
  expect(evaluateCondition(payload, { field: 'nonexistent.path', op: '>', value: 0 })).toBe(false)
})

// --- evaluateWatcher ---
test('match=all (AND) — all true', () => {
  expect(evaluateWatcher(payload, {
    conditions: [
      { field: 'sensors.environmental.temperature.value', op: '>', value: 40 },
      { field: 'sensors.environmental.humidity.value', op: '>', value: 80 },
    ],
    match: 'all',
  })).toBe(true)
})

test('match=all (AND) — one false', () => {
  expect(evaluateWatcher(payload, {
    conditions: [
      { field: 'sensors.environmental.temperature.value', op: '>', value: 40 },
      { field: 'sensors.environmental.humidity.value', op: '>', value: 90 },
    ],
    match: 'all',
  })).toBe(false)
})

test('match=any (OR) — one true', () => {
  expect(evaluateWatcher(payload, {
    conditions: [
      { field: 'sensors.environmental.temperature.value', op: '>', value: 100 },
      { field: 'sensors.air_quality.smoke.value', op: '>', value: 0.01 },
    ],
    match: 'any',
  })).toBe(true)
})

test('match=any (OR) — all false', () => {
  expect(evaluateWatcher(payload, {
    conditions: [
      { field: 'sensors.environmental.temperature.value', op: '>', value: 100 },
      { field: 'sensors.air_quality.smoke.value', op: '>', value: 1.0 },
    ],
    match: 'any',
  })).toBe(false)
})
