/**
 * HTTP client for talking to the livetap daemon.
 */

import { resolve } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, unlinkSync } from 'fs'

const STATE_DIR = resolve(homedir(), '.livetap')
const PID_PATH = resolve(STATE_DIR, 'daemon.pid')

export { PID_PATH, STATE_DIR }

export function getDaemonUrl(): string {
  const port = process.env.LIVETAP_PORT || '8788'
  return `http://127.0.0.1:${port}`
}

export function getDaemonPort(): number {
  return parseInt(process.env.LIVETAP_PORT || '8788')
}

export async function isDaemonRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${getDaemonUrl()}/status`)
    return res.ok
  } catch {
    return false
  }
}

/**
 * Read PID from daemon.pid file. Returns undefined if missing or stale.
 */
export function readPid(): number | undefined {
  try {
    if (!existsSync(PID_PATH)) return undefined
    const pid = parseInt(readFileSync(PID_PATH, 'utf-8').trim())
    if (isNaN(pid)) return undefined
    return pid
  } catch {
    return undefined
  }
}

/**
 * Check if a PID is alive.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Clean up stale PID file.
 */
export function cleanPidFile(): void {
  try { unlinkSync(PID_PATH) } catch { /* ok */ }
}

export async function daemonFetch(path: string, opts?: RequestInit): Promise<Response> {
  const url = `${getDaemonUrl()}${path}`
  try {
    return await fetch(url, opts)
  } catch (err) {
    console.error('Error: livetap daemon is not running. Use "livetap start" or "livetap setup" to start it.')
    process.exit(1)
  }
}

export async function daemonJson(path: string, opts?: RequestInit): Promise<any> {
  const res = await daemonFetch(path, opts)
  return res.json()
}
