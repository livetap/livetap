/**
 * livetap watchers [connectionId] — List watchers.
 */

import { isDaemonRunning, daemonJson } from './daemon-client.js'

export async function run(args: string[]) {
  if (!(await isDaemonRunning())) {
    console.log('livetap is not running. Use "livetap start" first.')
    return
  }

  const connId = args.find((a) => !a.startsWith('-'))
  const jsonMode = args.includes('--json')

  if (!connId) {
    // List all connections first, then watchers for each
    const conns = await daemonJson('/connections')
    if (conns.length === 0) {
      console.log('No active connections.')
      return
    }

    for (const c of conns) {
      const watchers = await daemonJson(`/watchers?connectionId=${c.connectionId}`)
      if (jsonMode) {
        console.log(JSON.stringify(watchers, null, 2))
        continue
      }
      if (watchers.length === 0) continue
      console.log(`Watchers for ${c.connectionId} (${c.type} → ${c.summary?.slice(0, 30) || ''}):\n`)
      printWatchers(watchers)
    }
    return
  }

  const data = await daemonJson(`/watchers?connectionId=${connId}`)

  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2))
    return
  }

  if (data.length === 0) {
    console.log(`No watchers for ${connId}.`)
    return
  }

  console.log(`Watchers for ${connId}:\n`)
  printWatchers(data)
}

function printWatchers(watchers: any[]) {
  for (const w of watchers) {
    const expr = w.conditions
      ?.map((c: any) => `${c.field} ${c.op} ${c.value}`)
      .join(w.match === 'all' ? ' AND ' : ' OR ') || '?'
    const last = w.lastMatch ? timeSince(w.lastMatch) : 'never'
    console.log(`  ${w.id}  ${expr}`)
    console.log(`         ${w.status}  ${w.matchCount ?? 0} matches  cooldown ${w.cooldown}s  last: ${last}\n`)
  }
}

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`
  return `${Math.round(ms / 3600_000)}h ago`
}
