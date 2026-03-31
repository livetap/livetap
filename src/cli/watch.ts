/**
 * livetap watch <connectionId> "expression" — Create a watcher.
 */

import { daemonFetch } from './daemon-client.js'

export async function run(args: string[]) {
  const connId = args[0]
  const exprStr = args[1]

  if (!connId || !exprStr) {
    console.error('Usage: livetap watch <connectionId> "field > value"')
    console.error('  livetap watch conn_abc "temperature > 50"')
    console.error('  livetap watch conn_abc "temp > 50 AND humidity > 90"')
    console.error('  livetap watch conn_abc "temp > 50 OR smoke > 0.05"')
    process.exit(1)
  }

  const cooldownIdx = args.indexOf('--cooldown')
  const cooldown = cooldownIdx !== -1 ? parseInt(args[cooldownIdx + 1]) : 60

  const { conditions, match } = parseExpression(exprStr)

  // Parse action flag
  const actionIdx = args.indexOf('--action')
  let action: any = 'channel_alert'
  if (actionIdx !== -1) {
    const actionStr = args[actionIdx + 1]
    if (actionStr.startsWith('webhook:')) {
      action = { webhook: actionStr.slice(8) }
    } else if (actionStr.startsWith('shell:')) {
      action = { shell: actionStr.slice(6) }
    } else {
      action = actionStr
    }
  }

  const res = await daemonFetch('/watchers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId: connId, conditions, match, action, cooldown }),
  })

  const data = await res.json()

  if (!res.ok) {
    console.error(`Error: ${data.error}`)
    process.exit(1)
  }

  console.log(`Watcher created: ${data.id} (${data.expression}, cooldown ${cooldown}s)`)
}

function parseExpression(expr: string): { conditions: any[]; match: 'all' | 'any' } {
  let match: 'all' | 'any' = 'all'
  let parts: string[]

  if (expr.includes(' AND ')) {
    parts = expr.split(' AND ').map((s) => s.trim())
    match = 'all'
  } else if (expr.includes(' OR ')) {
    parts = expr.split(' OR ').map((s) => s.trim())
    match = 'any'
  } else {
    parts = [expr.trim()]
  }

  const conditions = parts.map((part) => {
    // Match: field op value
    const m = part.match(/^(.+?)\s*(>=|<=|!=|>|<|==|contains)\s*(.+)$/)
    if (!m) {
      console.error(`Cannot parse condition: "${part}"`)
      console.error('Expected format: "field op value" (e.g. "temperature > 50")')
      process.exit(1)
    }

    const field = m[1].trim()
    const op = m[2].trim()
    let value: any = m[3].trim()

    // Parse value type
    if (value === 'true') value = true
    else if (value === 'false') value = false
    else if (!isNaN(Number(value))) value = Number(value)
    else value = value.replace(/^["']|["']$/g, '') // strip quotes

    return { field, op, value }
  })

  return { conditions, match }
}
