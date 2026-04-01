/**
 * livetap start — Start the daemon in background or foreground.
 */

import { resolve } from 'path'
import { homedir } from 'os'
import { mkdirSync, writeFileSync } from 'fs'
import { isDaemonRunning, getDaemonUrl, getDaemonPort, PID_PATH, STATE_DIR } from './daemon-client.js'

const LOG_DIR = resolve(STATE_DIR, 'logs')

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
    await import('../server/index.js')
    return
  }

  // Background: spawn detached
  const port = String(getDaemonPort())
  const daemonEntry = resolve(import.meta.dir, '../server/index.ts')

  const proc = Bun.spawn(['bun', daemonEntry], {
    env: { ...process.env, LIVETAP_PORT: port },
    stdout: 'ignore',
    stderr: 'ignore',
  })
  proc.unref()

  // Wait for it to be ready
  const deadline = Date.now() + 15_000
  let ready = false
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/status`)
      if (res.ok) {
        writeFileSync(PID_PATH, String(proc.pid))
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
