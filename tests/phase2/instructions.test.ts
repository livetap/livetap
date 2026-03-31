import { test, expect } from 'bun:test'

// Read the instructions directly from the channel module source
const source = await Bun.file('src/mcp/channel.ts').text()

// Extract the INSTRUCTIONS string
const match = source.match(/const INSTRUCTIONS = `([\s\S]*?)`\.trim\(\)/)
const instructions = match?.[1] ?? ''

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
  expect(instructions).toContain('webhook')
})

test('instructions mention key tools', () => {
  expect(instructions).toContain('create_connection')
  expect(instructions).toContain('read_stream')
  expect(instructions).toContain('list_connections')
  expect(instructions).toContain('destroy_connection')
})

test('instructions explain channel events', () => {
  expect(instructions).toContain('CHANNEL EVENTS')
  expect(instructions).toContain('<channel source="livetap"')
})

test('instructions tell agent to sample before watching', () => {
  expect(instructions).toContain('ALWAYS sample before creating a watcher')
})
