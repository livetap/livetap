/**
 * Types for the livetap stream service.
 * Schema-agnostic — the service knows nothing about payload contents.
 */

// --- Connection config (discriminated union) ---

export interface MqttConnectionConfig {
  type: 'mqtt'
  broker: string
  port: number
  tls: boolean
  credentials: { username: string; password: string }
  topics: string[]
}

export interface WebhookConnectionConfig {
  type: 'webhook'
}

export interface WebSocketConnectionConfig {
  type: 'websocket'
  url: string
  headers?: Record<string, string>
  handshake?: string
  reconnect?: {
    enabled: boolean
    maxRetries: number
    initialDelayMs: number
    maxDelayMs: number
  }
  pingIntervalMs?: number
  binaryFormat?: 'json' | 'text' | 'base64'
}

export type ConnectionConfig =
  | MqttConnectionConfig
  | WebhookConnectionConfig
  | WebSocketConnectionConfig

// --- Connection status ---

export interface ConnectionStatus {
  connectionId: string
  type: 'mqtt' | 'webhook' | 'websocket'
  name?: string
  summary: string
  streamKey: string
  createdAt: string
  msgPerSec: number
  bufferedCount: number
  runtimeState: 'connected' | 'reconnecting' | 'disconnected' | 'error'
  ingestUrl?: string
  error?: string
}

// --- Stream entry ---

export interface StreamEntry {
  id: string
  fields: Record<string, string>
  ts: number
}

// --- Subscriber interface ---

export interface Subscriber {
  start(): Promise<void>
  stop(): Promise<void>
  getStatus(): { runtimeState: ConnectionStatus['runtimeState']; error?: string }
}

// --- Connection record (internal) ---

export interface ConnectionRecord {
  id: string
  config: ConnectionConfig
  name?: string
  streamKey: string
  createdAt: string
  subscriber: Subscriber
  msgCount: number
  msgCountAtLastSample: number
  msgPerSec: number
  bufferedCount: number
  throughputInterval?: ReturnType<typeof setInterval>
  bufferedInterval?: ReturnType<typeof setInterval>
}
