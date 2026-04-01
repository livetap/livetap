/**
 * livetap status — Show daemon, connections, and watchers.
 */

import { isDaemonRunning, daemonJson, readPid } from './daemon-client.js'

export async function run(args: string[]) {
  if (!(await isDaemonRunning())) {
    const pid = readPid()
    if (pid) {
      console.log(`livetap daemon is not responding (stale PID ${pid}). Try "livetap start".`)
    } else {
      console.log('livetap is not running. Use "livetap start" or "livetap setup" to begin.')
    }
    return
  }

  const jsonMode = args.includes('--json')
  const data = await daemonJson('/status')

  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2))
    return
  }

  const uptime = formatUptime(data.uptime)
  console.log(`livetap daemon running on :${data.port} (uptime ${uptime})\n`)

  const conns = data.connections || []
  if (conns.length === 0) {
    console.log('No active connections. Use "livetap tap <uri>" to connect.\n')
  } else {
    console.log(`Connections (${conns.length}):`)
    for (const c of conns) {
      const rate = `${c.msgPerSec} msg/s`
      const buf = `${c.bufferedCount} buffered`
      console.log(`  ${c.connectionId}  ${c.type.padEnd(9)} ${c.summary.slice(0, 40).padEnd(42)} ${rate.padStart(10)}  ${buf}`)
    }
    console.log()
  }

  // Fetch watcher count
  try {
    const watchers = await daemonJson('/watchers')
    if (watchers.length > 0) {
      const running = watchers.filter((w: any) => w.status === 'running').length
      console.log(`Watchers (${watchers.length}, ${running} running)`)
      for (const w of watchers) {
        const expr = w.conditions?.map((c: any) => `${c.field} ${c.op} ${c.value}`).join(w.match === 'all' ? ' AND ' : ' OR ') ?? ''
        console.log(`  ${w.id}  ${w.status.padEnd(8)} ${expr.slice(0, 50)}`)
      }
      console.log()
    }
  } catch { /* no watchers endpoint or error */ }
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return `${h}h ${m}m`
}
