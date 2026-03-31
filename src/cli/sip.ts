/**
 * livetap sip <connectionId> — Sample recent stream entries.
 */

import { daemonFetch } from './daemon-client.js'

export async function run(args: string[]) {
  const id = args[0]
  if (!id) {
    console.error('Usage: livetap sip <connectionId>')
    process.exit(1)
  }

  const rawMode = args.includes('--raw')
  const maxIdx = args.indexOf('--max')
  const maxEntries = maxIdx !== -1 ? parseInt(args[maxIdx + 1]) : 10
  const backIdx = args.indexOf('--back')
  const backfillSeconds = backIdx !== -1 ? parseInt(args[backIdx + 1]) : 60

  const params = new URLSearchParams({
    backfillSeconds: String(backfillSeconds),
    maxEntries: String(maxEntries),
  })

  const res = await daemonFetch(`/connections/${id}/stream?${params}`)
  const data = await res.json()

  if (!res.ok) {
    console.error(`Error: ${data.error}`)
    process.exit(1)
  }

  if (rawMode) {
    console.log(JSON.stringify(data, null, 2))
    return
  }

  const entries = data.entries || []
  if (entries.length === 0) {
    console.log('No entries yet. Data may still be flowing in — try again in a few seconds.')
    return
  }

  console.log(`${entries.length} entries:\n`)
  for (const entry of entries) {
    const time = new Date(entry.ts).toISOString().slice(11, 19)
    const topic = entry.fields.topic || ''
    const payload = entry.fields.payload || ''

    console.log(`[${time}]${topic ? ` topic=${topic}` : ''}`)

    // Try to pretty-print JSON payload
    try {
      const parsed = JSON.parse(payload)
      const summary = summarizePayload(parsed)
      if (summary) {
        console.log(`         ${summary}`)
      } else {
        console.log(`         ${payload.slice(0, 120)}${payload.length > 120 ? '...' : ''}`)
      }
    } catch {
      console.log(`         ${payload.slice(0, 120)}${payload.length > 120 ? '...' : ''}`)
    }
    console.log()
  }
}

function summarizePayload(obj: any, prefix = '', depth = 0): string {
  if (depth > 2) return ''
  const parts: string[] = []

  for (const [key, val] of Object.entries(obj)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const nested = summarizePayload(val, `${prefix}${key}.`, depth + 1)
      if (nested) parts.push(nested)
    } else if (typeof val === 'number') {
      parts.push(`${prefix}${key}=${typeof val === 'number' ? val.toFixed(1) : val}`)
    } else if (typeof val === 'boolean') {
      parts.push(`${prefix}${key}=${val}`)
    }
  }
  return parts.join(' ')
}
