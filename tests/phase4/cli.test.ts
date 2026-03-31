import { test, expect, beforeAll, afterAll } from 'bun:test'

const PORT = 18792
let serverProc: ReturnType<typeof Bun.spawn>

function cli(...args: string[]): Promise<string> {
  return new Promise(async (resolve) => {
    const proc = Bun.spawn(['bun', 'bin/livetap.ts', ...args], {
      env: { ...process.env, LIVETAP_PORT: String(PORT) },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const out = await new Response(proc.stdout).text()
    const err = await new Response(proc.stderr).text()
    resolve(out + err)
  })
}

beforeAll(async () => {
  serverProc = Bun.spawn(['bun', 'src/server/index.ts'], {
    env: { ...process.env, LIVETAP_PORT: String(PORT) },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/status`)
      if (res.ok) break
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500))
  }
})

afterAll(() => {
  serverProc?.kill()
})

test('help shows all commands', async () => {
  const out = await cli('help')
  expect(out).toContain('livetap start')
  expect(out).toContain('livetap tap')
  expect(out).toContain('livetap sip')
  expect(out).toContain('livetap watch')
})

test('status shows running daemon', async () => {
  const out = await cli('status')
  expect(out).toContain('livetap daemon running')
})

test('tap webhook + taps + sip + untap', async () => {
  // Tap
  const tapOut = await cli('tap', 'webhook', '--name', 'CLI Test')
  expect(tapOut).toContain('Tapped:')
  expect(tapOut).toContain('Ingest URL:')

  // Extract conn ID
  const connId = tapOut.match(/conn_[0-9a-f]+/)?.[0]
  expect(connId).toBeTruthy()

  // Taps
  const tapsOut = await cli('taps')
  expect(tapsOut).toContain(connId!)
  expect(tapsOut).toContain('webhook')

  // Ingest some data
  await fetch(`http://127.0.0.1:${PORT}/connections/${connId}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ temp: 42, sensor: 'zone-a' }),
  })

  // Sip
  const sipOut = await cli('sip', connId!)
  expect(sipOut).toContain('"temp": 42')

  // Untap
  const untapOut = await cli('untap', connId!)
  expect(untapOut).toContain('Untapped:')
})

test('watch + watchers + unwatch', async () => {
  // Create connection first
  const tapOut = await cli('tap', 'webhook')
  const connId = tapOut.match(/conn_[0-9a-f]+/)?.[0]!

  // Watch
  const watchOut = await cli('watch', connId, 'temp > 40', '--cooldown', '5')
  expect(watchOut).toContain('Watcher created:')
  const watcherId = watchOut.match(/w_[0-9a-f]+/)?.[0]!

  // Watchers
  const watchersOut = await cli('watchers', connId)
  expect(watchersOut).toContain(watcherId)
  expect(watchersOut).toContain('temp > 40')
  expect(watchersOut).toContain('running')

  // Unwatch
  const unwatchOut = await cli('unwatch', watcherId)
  expect(unwatchOut).toContain('Unwatched:')

  // Cleanup
  await cli('untap', connId)
})

test('tap mqtt:// parses URI correctly', async () => {
  const out = await cli('tap', 'mqtt://broker.emqx.io:1883/justinx/demo/#')
  expect(out).toContain('Tapped:')
  expect(out).toContain('broker.emqx.io')

  const connId = out.match(/conn_[0-9a-f]+/)?.[0]!
  await cli('untap', connId)
})

test('sip with no entries shows helpful message', async () => {
  const tapOut = await cli('tap', 'webhook')
  const connId = tapOut.match(/conn_[0-9a-f]+/)?.[0]!

  const sipOut = await cli('sip', connId)
  expect(sipOut).toContain('No entries yet')

  await cli('untap', connId)
})

test('unknown command shows error', async () => {
  const out = await cli('bogus')
  expect(out).toContain('Unknown command')
})
