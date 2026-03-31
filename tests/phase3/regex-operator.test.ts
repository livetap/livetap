import { test, expect } from 'bun:test'
import { evaluateCondition, evaluateWatcher } from '../../src/server/watchers/engine.js'

// --- matches operator unit tests ---

test('matches: simple pattern', () => {
  expect(evaluateCondition({ msg: 'ERROR: disk full' }, { field: 'msg', op: 'matches', value: 'ERROR' })).toBe(true)
  expect(evaluateCondition({ msg: 'INFO: all good' }, { field: 'msg', op: 'matches', value: 'ERROR' })).toBe(false)
})

test('matches: regex alternation', () => {
  expect(evaluateCondition({ level: 'ERROR' }, { field: 'level', op: 'matches', value: 'ERROR|FATAL|PANIC' })).toBe(true)
  expect(evaluateCondition({ level: 'FATAL' }, { field: 'level', op: 'matches', value: 'ERROR|FATAL|PANIC' })).toBe(true)
  expect(evaluateCondition({ level: 'INFO' }, { field: 'level', op: 'matches', value: 'ERROR|FATAL|PANIC' })).toBe(false)
})

test('matches: HTTP status codes', () => {
  expect(evaluateCondition({ status: '503' }, { field: 'status', op: 'matches', value: '5[0-9]{2}' })).toBe(true)
  expect(evaluateCondition({ status: '404' }, { field: 'status', op: 'matches', value: '5[0-9]{2}' })).toBe(false)
  expect(evaluateCondition({ status: '200' }, { field: 'status', op: 'matches', value: '5[0-9]{2}' })).toBe(false)
})

test('matches: on numeric values (coerced to string)', () => {
  expect(evaluateCondition({ code: 503 }, { field: 'code', op: 'matches', value: '5[0-9]{2}' })).toBe(true)
  expect(evaluateCondition({ code: 200 }, { field: 'code', op: 'matches', value: '5[0-9]{2}' })).toBe(false)
})

test('matches: case-sensitive by default', () => {
  expect(evaluateCondition({ msg: 'error occurred' }, { field: 'msg', op: 'matches', value: 'ERROR' })).toBe(false)
  expect(evaluateCondition({ msg: 'error occurred' }, { field: 'msg', op: 'matches', value: '[Ee]rror' })).toBe(true)
})

test('matches: MQTT topic patterns', () => {
  expect(evaluateCondition({ topic: 'sensor-zone-a/telemetry' }, { field: 'topic', op: 'matches', value: 'sensor-zone-[ab]' })).toBe(true)
  expect(evaluateCondition({ topic: 'sensor-zone-c/telemetry' }, { field: 'topic', op: 'matches', value: 'sensor-zone-[ab]' })).toBe(false)
})

test('matches: WebSocket price data (string price field)', () => {
  expect(evaluateCondition({ p: '67253.56000000' }, { field: 'p', op: 'matches', value: '^6[789]' })).toBe(true)
  expect(evaluateCondition({ p: '50123.00000000' }, { field: 'p', op: 'matches', value: '^6[789]' })).toBe(false)
})

test('matches: plain text log lines (full payload)', () => {
  const logLine = '2026-03-31 10:00:01 [ERROR] Connection refused to database:5432'
  expect(evaluateCondition({ payload: logLine }, { field: 'payload', op: 'matches', value: '\\[ERROR\\]' })).toBe(true)
  expect(evaluateCondition({ payload: logLine }, { field: 'payload', op: 'matches', value: '\\[WARN\\]' })).toBe(false)
  expect(evaluateCondition({ payload: logLine }, { field: 'payload', op: 'matches', value: 'database:\\d+' })).toBe(true)
})

test('matches: returns false for missing field', () => {
  expect(evaluateCondition({}, { field: 'nonexistent', op: 'matches', value: '.*' })).toBe(false)
})

test('matches: invalid regex returns false (no crash)', () => {
  expect(evaluateCondition({ msg: 'test' }, { field: 'msg', op: 'matches', value: '[invalid' })).toBe(false)
})

test('matches: combined with other ops in watcher (AND)', () => {
  const payload = {
    sensors: { environmental: { temperature: { value: 55 } } },
    metadata: { device_name: 'sensor-zone-a' },
  }
  expect(evaluateWatcher(payload, {
    conditions: [
      { field: 'sensors.environmental.temperature.value', op: '>', value: 50 },
      { field: 'metadata.device_name', op: 'matches', value: 'zone-[a-c]' },
    ],
    match: 'all',
  })).toBe(true)
})

test('matches: combined with other ops in watcher (OR)', () => {
  const payload = { level: 'INFO', msg: 'health check passed' }
  expect(evaluateWatcher(payload, {
    conditions: [
      { field: 'level', op: 'matches', value: 'ERROR|FATAL' },
      { field: 'msg', op: 'contains', value: 'timeout' },
    ],
    match: 'any',
  })).toBe(false)

  const errorPayload = { level: 'ERROR', msg: 'health check passed' }
  expect(evaluateWatcher(errorPayload, {
    conditions: [
      { field: 'level', op: 'matches', value: 'ERROR|FATAL' },
      { field: 'msg', op: 'contains', value: 'timeout' },
    ],
    match: 'any',
  })).toBe(true)
})
