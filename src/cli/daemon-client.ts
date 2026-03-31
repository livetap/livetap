/**
 * HTTP client for talking to the livetap daemon.
 */

import { resolve } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync } from 'fs'

const STATE_PATH = resolve(homedir(), '.livetap', 'state.json')

export function getDaemonUrl(): string {
  const port = process.env.LIVETAP_PORT || '8788'
  return `http://127.0.0.1:${port}`
}

export async function isDaemonRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${getDaemonUrl()}/status`)
    return res.ok
  } catch {
    return false
  }
}

export function requireDaemon() {
  // Called at start of commands that need the daemon
  // Actual check is async, so this just prints the message format
}

export async function daemonFetch(path: string, opts?: RequestInit): Promise<Response> {
  const url = `${getDaemonUrl()}${path}`
  try {
    return await fetch(url, opts)
  } catch (err) {
    console.error('Error: livetap daemon is not running. Use "livetap start" first.')
    process.exit(1)
  }
}

export async function daemonJson(path: string, opts?: RequestInit): Promise<any> {
  const res = await daemonFetch(path, opts)
  return res.json()
}
