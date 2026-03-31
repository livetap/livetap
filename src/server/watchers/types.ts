/**
 * Watcher types for expression-based alerting.
 */

export interface WatcherCondition {
  field: string
  op: '>' | '<' | '>=' | '<=' | '==' | '!=' | 'contains'
  value: number | string | boolean
}

export type WatcherAction =
  | 'channel_alert'
  | { webhook: string }
  | { shell: string }

export interface WatcherDefinition {
  id: string
  connectionId: string
  conditions: WatcherCondition[]
  match: 'all' | 'any'
  action: WatcherAction
  cooldown: number
  status: 'running' | 'stopped'
  createdAt: string
  updatedAt: string
}

export interface WatcherInfo extends WatcherDefinition {
  lastChecked?: string
  matchCount: number
  lastMatch?: string
  entriesChecked: number
}

export interface WatcherAlert {
  watcherId: string
  connectionId: string
  expression: string
  matchedValues: Record<string, unknown>
  entry: Record<string, string>
  ts: number
}

export const VALID_OPS = ['>', '<', '>=', '<=', '==', '!=', 'contains'] as const
