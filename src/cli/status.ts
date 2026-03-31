/**
 * livetap status — Show daemon, connections, and watchers.
 */

import { isDaemonRunning, daemonJson } from './daemon-client.js'

export async function run(args: string[]) {
  if (!(await isDaemonRunning())) {
    console.log('livetap is not running. Use "livetap start" to begin.')
    return
  }

  const jsonMode = args.includes('--json')
  const data = await daemonJson('/status')

  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2))
    return
  }

  const uptime = formatUptime(data.uptime)
  console.log(`livetap daemon running on :${data.port} (uptime ${uptime})`)
  console.log(`Redis: localhost:${data.redisPort}\n`)

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
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return `${h}h ${m}m`
}
