/**
 * livetap watchers [connectionId] — List watchers.
 */

import { isDaemonRunning, daemonJson } from './daemon-client.js'

export async function run(args: string[]) {
  if (!(await isDaemonRunning())) {
    console.log('livetap is not running. Use "livetap start" first.')
    return
  }

  const jsonMode = args.includes('--json')

  // --logs <watcherId> — show watcher logs
  const logsIdx = args.indexOf('--logs')
  if (logsIdx !== -1) {
    const watcherId = args[logsIdx + 1]
    if (!watcherId) {
      console.error('Usage: livetap watchers --logs <watcherId>')
      process.exit(1)
    }
    const data = await daemonJson(`/watchers/${watcherId}/logs`)
    if (jsonMode) {
      console.log(JSON.stringify(data, null, 2))
    } else {
      console.log(`Logs for ${watcherId}:\n`)
      for (const line of data.logs || []) {
        console.log(`  ${line}`)
      }
      if (!data.logs?.length) console.log('  (no logs yet)')
    }
    return
  }

  // Filter args: anything that doesn't start with - and isn't after a flag
  const positional = args.filter((a) => !a.startsWith('-'))
  const arg = positional[0]

  // If it looks like a watcher ID, show that watcher's details
  if (arg?.startsWith('w_')) {
    const info = await daemonJson(`/watchers/${arg}`)
    if (info.error) {
      console.error(`Error: ${info.error}`)
      return
    }
    if (jsonMode) {
      console.log(JSON.stringify(info, null, 2))
    } else {
      const expr = info.conditions
        ?.map((c: any) => `${c.field} ${c.op} ${c.value}`)
        .join(info.match === 'all' ? ' AND ' : ' OR ') || '?'
      console.log(`Watcher ${info.id}:`)
      console.log(`  Connection: ${info.connectionId}`)
      console.log(`  Expression: ${expr}`)
      console.log(`  Status: ${info.status}  Matches: ${info.matchCount ?? 0}  Cooldown: ${info.cooldown}s`)
      if (info.lastMatch) console.log(`  Last match: ${info.lastMatch}`)
      console.log(`  Created: ${info.createdAt}`)
    }
    return
  }

  const connId = arg

  const params = connId ? `?connectionId=${connId}` : ''
  const data = await daemonJson(`/watchers${params}`)

  // Handle error response (e.g. old daemon that requires connectionId)
  if (data.error) {
    console.error(`Error: ${data.error}`)
    return
  }

  const list = Array.isArray(data) ? data : []

  if (jsonMode) {
    console.log(JSON.stringify(list, null, 2))
    return
  }

  if (list.length === 0) {
    console.log(connId ? `No watchers for ${connId}.` : 'No watchers.')
    return
  }

  // Group by connectionId for display
  const grouped = new Map<string, any[]>()
  for (const w of list) {
    const key = w.connectionId
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(w)
  }

  for (const [cid, ws] of grouped) {
    console.log(`Watchers for ${cid}:\n`)
    printWatchers(ws)
  }
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
