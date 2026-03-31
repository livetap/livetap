/**
 * livetap stop — Stop the daemon.
 */

import { resolve } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { isDaemonRunning, getDaemonUrl } from './daemon-client.js'

const STATE_PATH = resolve(homedir(), '.livetap', 'state.json')

export async function run(_args: string[]) {
  if (!(await isDaemonRunning())) {
    // Try reading PID from state file
    if (existsSync(STATE_PATH)) {
      try {
        const state = JSON.parse(readFileSync(STATE_PATH, 'utf-8'))
        try { process.kill(state.pid, 'SIGTERM') } catch { /* already dead */ }
        unlinkSync(STATE_PATH)
        console.log('livetap daemon stopped (cleaned up stale state)')
      } catch {
        unlinkSync(STATE_PATH)
      }
    } else {
      console.log('livetap is not running.')
    }
    return
  }

  // Read state for PID
  let pid: number | undefined
  if (existsSync(STATE_PATH)) {
    try {
      const state = JSON.parse(readFileSync(STATE_PATH, 'utf-8'))
      pid = state.pid
    } catch { /* malformed */ }
  }

  // Send SIGTERM
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch { /* already gone */ }
  }

  // Wait for shutdown
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (!(await isDaemonRunning())) break
    await new Promise((r) => setTimeout(r, 300))
  }

  // Force kill if still running
  if (await isDaemonRunning()) {
    if (pid) try { process.kill(pid, 'SIGKILL') } catch { /* ok */ }
  }

  // Clean up state
  if (existsSync(STATE_PATH)) {
    try { unlinkSync(STATE_PATH) } catch { /* ok */ }
  }

  console.log('livetap daemon stopped')
}
