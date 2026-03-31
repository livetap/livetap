/**
 * livetap start — Start the daemon in background or foreground.
 */

import { resolve } from 'path'
import { homedir } from 'os'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { isDaemonRunning, getDaemonUrl } from './daemon-client.js'

const STATE_DIR = resolve(homedir(), '.livetap')
const LOG_DIR = resolve(STATE_DIR, 'logs')
const STATE_PATH = resolve(STATE_DIR, 'state.json')

export async function run(args: string[]) {
  const foreground = args.includes('--foreground') || args.includes('-f')
  const portFlag = args.indexOf('--port')
  if (portFlag !== -1 && args[portFlag + 1]) {
    process.env.LIVETAP_PORT = args[portFlag + 1]
  }

  if (await isDaemonRunning()) {
    const res = await fetch(`${getDaemonUrl()}/status`)
    const status = await res.json()
    console.log(`livetap is already running on :${status.port} (${status.connections.length} connections)`)
    return
  }

  mkdirSync(LOG_DIR, { recursive: true })

  if (foreground) {
    console.log('Starting livetap in foreground...')
    // Import and run directly
    await import('../server/index.js')
    return
  }

  // Background: spawn detached
  const port = process.env.LIVETAP_PORT || '8788'
  const logFile = Bun.file(resolve(LOG_DIR, 'daemon.log'))
  const logFd = logFile.writer()

  const proc = Bun.spawn(['bun', resolve(import.meta.dir, '../server/index.ts')], {
    env: { ...process.env, LIVETAP_PORT: port },
    stdout: 'ignore',
    stderr: 'ignore',
  })

  // Wait for it to be ready
  const deadline = Date.now() + 15_000
  let ready = false
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/status`)
      if (res.ok) {
        const data = await res.json()
        writeFileSync(STATE_PATH, JSON.stringify({
          pid: proc.pid,
          port: parseInt(port),
          redisPort: data.redisPort,
          startedAt: new Date().toISOString(),
        }, null, 2))
        ready = true
        break
      }
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500))
  }

  if (ready) {
    console.log(`livetap daemon started on :${port} (pid ${proc.pid})`)
  } else {
    console.error('Error: daemon failed to start within 15s. Check ~/.livetap/logs/daemon.log')
    process.exit(1)
  }
}
