import { test, expect } from 'bun:test'
import { generateInstructions } from '../../src/shared/catalog-generators.js'

const instructions = generateInstructions()

test('instructions contain workflow steps', () => {
  expect(instructions).toContain('WORKFLOW')
  expect(instructions).toContain('CONNECT')
  expect(instructions).toContain('SAMPLE')
  expect(instructions).toContain('WATCH')
  expect(instructions).toContain('MANAGE')
})

test('instructions mention all connection types', () => {
  expect(instructions).toContain('mqtt')
  expect(instructions).toContain('websocket')
  expect(instructions).toContain('file')
})

test('instructions mention key tools', () => {
  expect(instructions).toContain('create_connection')
  expect(instructions).toContain('read_stream')
  expect(instructions).toContain('list_connections')
  expect(instructions).toContain('destroy_connection')
})

test('instructions explain channel events', () => {
  expect(instructions).toContain('CHANNEL EVENTS')
  expect(instructions).toContain('<channel source="LiveTap"')
})

test('instructions tell agent to sample before watching', () => {
  expect(instructions).toContain('ALWAYS sample before creating a watcher')
})

test('instructions list all available tools', () => {
  expect(instructions).toContain('AVAILABLE TOOLS')
  expect(instructions).toContain('create_watcher')
  expect(instructions).toContain('get_watcher_logs')
  expect(instructions).toContain('restart_watcher')
})
