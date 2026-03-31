import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { resolve } from 'path'

const TMP = resolve(import.meta.dir, '..', '..', '.tmp-postinstall-test')

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
  // Create a minimal package.json so findProjectRoot works
  writeFileSync(resolve(TMP, 'package.json'), '{}')
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

function runPostinstall(env: Record<string, string> = {}): string {
  const proc = Bun.spawnSync(['bun', resolve(import.meta.dir, '..', '..', 'scripts', 'postinstall.ts')], {
    cwd: TMP,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return new TextDecoder().decode(proc.stdout) + new TextDecoder().decode(proc.stderr)
}

test('creates .mcp.json when none exists', () => {
  runPostinstall()
  const mcpPath = resolve(TMP, '.mcp.json')
  expect(existsSync(mcpPath)).toBe(true)

  const config = JSON.parse(readFileSync(mcpPath, 'utf-8'))
  expect(config.mcpServers).toBeDefined()
  expect(config.mcpServers.livetap).toBeDefined()
  expect(config.mcpServers.livetap.command).toBe('bun')
  expect(config.mcpServers.livetap.args[0]).toContain('channel.ts')
})

test('adds livetap without clobbering existing servers', () => {
  const mcpPath = resolve(TMP, '.mcp.json')
  writeFileSync(mcpPath, JSON.stringify({
    mcpServers: {
      'other-server': { command: 'node', args: ['other.js'] },
    },
  }))

  runPostinstall()

  const config = JSON.parse(readFileSync(mcpPath, 'utf-8'))
  expect(config.mcpServers['other-server']).toBeDefined()
  expect(config.mcpServers['other-server'].command).toBe('node')
  expect(config.mcpServers.livetap).toBeDefined()
})

test('skips if livetap already configured', () => {
  const mcpPath = resolve(TMP, '.mcp.json')
  const original = {
    mcpServers: {
      livetap: { command: 'bun', args: ['custom-path.ts'] },
    },
  }
  writeFileSync(mcpPath, JSON.stringify(original))

  const out = runPostinstall()
  expect(out).toContain('already configured')

  // Verify it didn't overwrite
  const config = JSON.parse(readFileSync(mcpPath, 'utf-8'))
  expect(config.mcpServers.livetap.args[0]).toBe('custom-path.ts')
})

test('handles malformed .mcp.json gracefully', () => {
  writeFileSync(resolve(TMP, '.mcp.json'), 'not json{{{')

  const out = runPostinstall()
  expect(out).toContain('malformed')

  // Verify it didn't overwrite the malformed file
  const content = readFileSync(resolve(TMP, '.mcp.json'), 'utf-8')
  expect(content).toBe('not json{{{')
})

test('skips in CI', () => {
  const out = runPostinstall({ CI: 'true' })

  // Should not create .mcp.json
  expect(existsSync(resolve(TMP, '.mcp.json'))).toBe(false)
})

test('skips with LIVETAP_SKIP_POSTINSTALL', () => {
  const out = runPostinstall({ LIVETAP_SKIP_POSTINSTALL: '1' })
  expect(existsSync(resolve(TMP, '.mcp.json'))).toBe(false)
})
