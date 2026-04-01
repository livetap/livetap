/**
 * livetap stop — Stop the daemon.
 */

import { isDaemonRunning, readPid, isPidAlive, cleanPidFile, getDaemonPort } from './daemon-client.js'

export async function run(_args: string[]) {
  const pid = readPid()
  const running = await isDaemonRunning()

  if (!running && !pid) {
    console.log('livetap is not running.')
    return
  }

  if (!running && pid) {
    // PID file exists but daemon isn't responding
    if (isPidAlive(pid)) {
      // Process exists but not responding on port — might be something else
      console.log(`Warning: PID ${pid} exists but daemon is not responding on :${getDaemonPort()}`)
      try { process.kill(pid, 'SIGTERM') } catch { /* ok */ }
    }
    cleanPidFile()
    console.log('livetap daemon stopped (cleaned up stale state)')
    return
  }

  // Daemon is running — send SIGTERM via PID or wait for port to close
  if (pid) {
    try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
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

  cleanPidFile()
  console.log('livetap daemon stopped')
}
