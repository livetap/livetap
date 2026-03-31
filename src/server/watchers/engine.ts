/**
 * Expression evaluation engine for watchers.
 * Resolves dot-paths, evaluates conditions, manages cooldown.
 */

import type { WatcherCondition, WatcherDefinition } from './types.js'

/**
 * Resolve a dot-separated path into a nested object.
 * Returns undefined if any segment is missing.
 */
export function resolveDotPath(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => o?.[k], obj)
}

/**
 * Evaluate a single condition against a parsed payload.
 * Returns false if the field doesn't exist (no crash).
 */
export function evaluateCondition(payload: any, condition: WatcherCondition): boolean {
  const value = resolveDotPath(payload, condition.field)
  if (value === undefined) return false

  switch (condition.op) {
    case '>':        return value > condition.value
    case '<':        return value < condition.value
    case '>=':       return value >= condition.value
    case '<=':       return value <= condition.value
    case '==':       return value == condition.value
    case '!=':       return value != condition.value
    case 'contains': return String(value).includes(String(condition.value))
    case 'matches':
      try { return new RegExp(String(condition.value)).test(String(value)) }
      catch { return false }
    default:         return false
  }
}

/**
 * Evaluate all conditions for a watcher against a payload.
 * match='all' → AND, match='any' → OR.
 */
export function evaluateWatcher(payload: any, watcher: Pick<WatcherDefinition, 'conditions' | 'match'>): boolean {
  const results = watcher.conditions.map((c) => evaluateCondition(payload, c))
  return watcher.match === 'all' ? results.every(Boolean) : results.some(Boolean)
}

/**
 * Extract the matched field values from a payload for a set of conditions.
 * Used in alert payloads to show what triggered the match.
 */
export function extractMatchedValues(payload: any, conditions: WatcherCondition[]): Record<string, unknown> {
  const matched: Record<string, unknown> = {}
  for (const c of conditions) {
    const value = resolveDotPath(payload, c.field)
    if (value !== undefined) {
      matched[c.field] = value
    }
  }
  return matched
}

/**
 * Format conditions as a human-readable expression string.
 */
export function formatExpression(conditions: WatcherCondition[], match: 'all' | 'any'): string {
  const parts = conditions.map((c) => `${c.field} ${c.op} ${c.value}`)
  const joiner = match === 'all' ? ' AND ' : ' OR '
  return parts.join(joiner)
}
