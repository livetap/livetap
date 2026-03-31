/**
 * Watcher Manager — CRUD + evaluation loops for expression watchers.
 * Stores definitions in Redis hashes. Runs evaluator loops in-process.
 */

import Redis from 'ioredis'
import { mkdirSync, appendFileSync, statSync, writeFileSync, readFileSync, unlinkSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import type { WatcherCondition, WatcherDefinition, WatcherInfo, WatcherAlert, WatcherAction } from './types.js'
import { VALID_OPS } from './types.js'
import { evaluateWatcher, extractMatchedValues, formatExpression } from './engine.js'

function generateId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `w_${hex}`
}

const LOG_DIR = resolve(homedir(), '.livetap', 'logs', 'watchers')
const MAX_LOG_SIZE = 512 * 1024 // 512KB

export type AlertCallback = (alert: WatcherAlert) => void

export class WatcherManager {
  private redisUrl: string
  private loops = new Map<string, { abort: AbortController; reader: Redis }>()
  private info = new Map<string, WatcherInfo>()
  private onAlert: AlertCallback
  private redis: Redis

  constructor(redis: Redis, redisUrl: string, onAlert: AlertCallback) {
    this.redis = redis
    this.redisUrl = redisUrl
    this.onAlert = onAlert
    mkdirSync(LOG_DIR, { recursive: true })
  }

  async create(
    connectionId: string,
    streamKey: string,
    conditions: WatcherCondition[],
    match: 'all' | 'any' = 'all',
    action: WatcherAction = 'channel_alert',
    cooldown = 60,
  ): Promise<WatcherInfo> {
    // Validate conditions
    if (!conditions.length) throw new Error('At least one condition is required.')
    for (const c of conditions) {
      if (!VALID_OPS.includes(c.op as any)) {
        throw new Error(`Invalid op '${c.op}'. Supported: ${VALID_OPS.join(', ')}`)
      }
      if (!c.field) throw new Error('Each condition must have a field.')
    }

    const id = generateId()
    const now = new Date().toISOString()

    const def: WatcherDefinition = {
      id,
      connectionId,
      conditions,
      match,
      action,
      cooldown,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    }

    // Store in flat hash (globally unique watcher IDs)
    await this.redis.hset('livetap:watchers', id, JSON.stringify(def))

    const info: WatcherInfo = { ...def, matchCount: 0, entriesChecked: 0 }
    this.info.set(id, info)

    this.writeLog(id, `STARTED conditions=${formatExpression(conditions, match)} cooldown=${cooldown}s`)
    this.startLoop(id, streamKey, def)

    return info
  }

  async list(connectionId?: string): Promise<WatcherInfo[]> {
    const all = Array.from(this.info.values())
    return connectionId ? all.filter((w) => w.connectionId === connectionId) : all
  }

  async get(watcherId: string): Promise<WatcherInfo | undefined> {
    return this.info.get(watcherId)
  }

  async getLogs(watcherId: string, lines = 50): Promise<string[]> {
    const logPath = resolve(LOG_DIR, `${watcherId}.log`)
    try {
      const content = readFileSync(logPath, 'utf-8')
      return content.split('\n').filter(Boolean).slice(-lines)
    } catch {
      return []
    }
  }

  async update(watcherId: string, streamKey: string | null, updates: {
    conditions?: WatcherCondition[]
    match?: 'all' | 'any'
    action?: WatcherAction
    cooldown?: number
  }): Promise<WatcherInfo | null> {
    const info = this.info.get(watcherId)
    if (!info) return null

    // Stop existing loop
    this.stopLoop(watcherId)

    // Apply updates
    if (updates.conditions) {
      for (const c of updates.conditions) {
        if (!VALID_OPS.includes(c.op as any)) {
          throw new Error(`Invalid op '${c.op}'. Supported: ${VALID_OPS.join(', ')}`)
        }
      }
      info.conditions = updates.conditions
    }
    if (updates.match) info.match = updates.match
    if (updates.action) info.action = updates.action
    if (updates.cooldown !== undefined) info.cooldown = updates.cooldown
    info.updatedAt = new Date().toISOString()
    info.status = 'running'

    // Persist
    const def: WatcherDefinition = { ...info }
    await this.redis.hset('livetap:watchers', watcherId, JSON.stringify(def))

    this.writeLog(watcherId, `UPDATED conditions=${formatExpression(info.conditions, info.match)} cooldown=${info.cooldown}s`)
    this.startLoop(watcherId, streamKey, info)

    return info
  }

  async restart(watcherId: string, streamKey: string | null): Promise<boolean> {
    const info = this.info.get(watcherId)
    if (!info) return false

    this.stopLoop(watcherId)
    info.status = 'running'
    this.writeLog(watcherId, 'RESTARTED')
    this.startLoop(watcherId, streamKey, info)
    return true
  }

  async delete(watcherId: string): Promise<boolean> {
    const info = this.info.get(watcherId)
    if (!info) return false

    this.stopLoop(watcherId)
    this.info.delete(watcherId)
    await this.redis.hdel('livetap:watchers', watcherId)

    // Delete log file
    try { unlinkSync(resolve(LOG_DIR, `${watcherId}.log`)) } catch { /* ok */ }

    return true
  }

  async deleteAllForConnection(connectionId: string): Promise<void> {
    const watchers = await this.list(connectionId)
    for (const w of watchers) {
      await this.delete(w.id)
    }
  }

  private startLoop(watcherId: string, streamKey: string, def: WatcherDefinition) {
    const abort = new AbortController()
    const reader = new Redis(this.redisUrl)
    this.loops.set(watcherId, { abort, reader })

    const info = this.info.get(watcherId)!
    let lastAlertTime = 0
    let checkpointTime = Date.now()
    const fieldNotFoundThrottle = new Map<string, number>() // field → last logged time

    const run = async () => {
      let lastId = '$'
      while (!abort.signal.aborted) {
        try {
          const result = await reader.xread('BLOCK', 2000, 'STREAMS', streamKey, lastId)
          if (!result || abort.signal.aborted) continue

          for (const [, entries] of result) {
            for (const [id, fieldArray] of entries) {
              lastId = id
              info.entriesChecked++
              info.lastChecked = new Date().toISOString()

              // Parse fields
              const fields: Record<string, string> = {}
              for (let i = 0; i < fieldArray.length; i += 2) {
                fields[fieldArray[i]] = fieldArray[i + 1]
              }

              // Parse payload JSON
              let payload: any
              try {
                payload = JSON.parse(fields.payload ?? '{}')
              } catch {
                continue // skip non-JSON
              }

              // Log missing fields (throttled: once per field per minute)
              for (const c of def.conditions) {
                const val = resolveDotPathImport(payload, c.field)
                if (val === undefined) {
                  const last = fieldNotFoundThrottle.get(c.field) ?? 0
                  if (Date.now() - last > 60_000) {
                    this.writeLog(watcherId, `FIELD_NOT_FOUND ${c.field} in entry ${id}`)
                    fieldNotFoundThrottle.set(c.field, Date.now())
                  }
                }
              }

              // Evaluate
              const matched = evaluateWatcher(payload, def)
              if (matched) {
                const now = Date.now()
                if (now - lastAlertTime >= def.cooldown * 1000) {
                  lastAlertTime = now
                  info.matchCount++
                  info.lastMatch = new Date().toISOString()

                  const matchedValues = extractMatchedValues(payload, def.conditions)
                  const expression = formatExpression(def.conditions, def.match)

                  this.writeLog(watcherId, `MATCH ${Object.entries(matchedValues).map(([k, v]) => `${k}=${v}`).join(' ')} action=${typeof def.action === 'string' ? def.action : JSON.stringify(def.action)}`)

                  const alert: WatcherAlert = {
                    watcherId,
                    connectionId: def.connectionId,
                    expression,
                    matchedValues,
                    entry: fields,
                    ts: now,
                  }

                  // Execute action
                  await this.executeAction(def.action, alert)
                  this.onAlert(alert)
                } else {
                  const remaining = Math.round((def.cooldown * 1000 - (Date.now() - lastAlertTime)) / 1000)
                  this.writeLog(watcherId, `SUPPRESSED ${formatExpression(def.conditions, def.match)} (cooldown ${remaining}s remaining)`)
                }
              }

              // Checkpoint every 5 minutes
              if (Date.now() - checkpointTime > 5 * 60 * 1000) {
                this.writeLog(watcherId, `CHECKPOINT entries_checked=${info.entriesChecked} matches=${info.matchCount}`)
                checkpointTime = Date.now()
              }
            }
          }
        } catch (err) {
          if (!abort.signal.aborted) {
            this.writeLog(watcherId, `ERROR ${(err as Error).message}`)
            await new Promise((r) => setTimeout(r, 1000))
          }
        }
      }
      reader.disconnect()
    }

    run()
  }

  private stopLoop(watcherId: string) {
    const loop = this.loops.get(watcherId)
    if (loop) {
      loop.abort.abort()
      loop.reader.disconnect()
      this.loops.delete(watcherId)
    }
    const info = this.info.get(watcherId)
    if (info) info.status = 'stopped'
  }

  private async executeAction(action: WatcherAction, alert: WatcherAlert) {
    if (action === 'channel_alert') return // handled by onAlert callback

    if (typeof action === 'object' && 'webhook' in action) {
      try {
        await fetch(action.webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(alert),
        })
      } catch (err) {
        this.writeLog(alert.watcherId, `WEBHOOK_ERROR ${(err as Error).message}`)
      }
    }

    if (typeof action === 'object' && 'shell' in action) {
      try {
        Bun.spawn(['sh', '-c', action.shell], {
          env: {
            ...process.env,
            LIVETAP_WATCHER: alert.watcherId,
            LIVETAP_PAYLOAD: JSON.stringify(alert.entry),
            LIVETAP_MATCHED: JSON.stringify(alert.matchedValues),
          },
        })
      } catch (err) {
        this.writeLog(alert.watcherId, `SHELL_ERROR ${(err as Error).message}`)
      }
    }
  }

  private writeLog(watcherId: string, msg: string) {
    const logPath = resolve(LOG_DIR, `${watcherId}.log`)
    const line = `[${new Date().toISOString()}] ${msg}\n`

    appendFileSync(logPath, line)

    // Size protection: truncate to last 256KB if over 512KB
    try {
      const stats = statSync(logPath)
      if (stats.size > MAX_LOG_SIZE) {
        const content = readFileSync(logPath, 'utf-8')
        const truncated = content.slice(-MAX_LOG_SIZE / 2)
        // Start from first complete line
        const firstNewline = truncated.indexOf('\n')
        writeFileSync(logPath, truncated.slice(firstNewline + 1))
      }
    } catch { /* ok */ }
  }

  async stopAll() {
    for (const id of this.loops.keys()) {
      this.stopLoop(id)
    }
  }
}

// Import from engine to avoid circular
function resolveDotPathImport(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => o?.[k], obj)
}
