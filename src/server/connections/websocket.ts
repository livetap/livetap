/**
 * WebSocket Subscriber — connects to a remote WebSocket and writes
 * messages to a stream with rolling retention + reconnection.
 */

import type { StreamStore } from '../stream-store.js'
import type { WebSocketConnectionConfig, Subscriber, ConnectionStatus } from '../types.js'

export interface WsSubscriberOpts {
  config: WebSocketConnectionConfig
  streamKey: string
  store: StreamStore
  retentionMs?: number
  onMessage?: () => void
}

export class WsSubscriber implements Subscriber {
  private ws: WebSocket | null = null
  private config: WebSocketConnectionConfig
  private streamKey: string
  private store: StreamStore
  private retentionMs: number
  private onMessage: (() => void) | undefined
  private state: ConnectionStatus['runtimeState'] = 'disconnected'
  private error?: string
  private retryCount = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private stopped = false

  constructor(opts: WsSubscriberOpts) {
    this.config = opts.config
    this.streamKey = opts.streamKey
    this.store = opts.store
    this.retentionMs = opts.retentionMs ?? 5 * 60 * 1000
    this.onMessage = opts.onMessage
  }

  async start(): Promise<void> {
    this.stopped = false
    this.connect()
  }

  private connect() {
    this.state = this.retryCount === 0 ? 'disconnected' : 'reconnecting'

    this.ws = new WebSocket(this.config.url)

    this.ws.onopen = () => {
      this.state = 'connected'
      this.error = undefined
      this.retryCount = 0

      if (this.config.handshake) {
        this.ws!.send(this.config.handshake)
      }

      const pingMs = this.config.pingIntervalMs ?? 30_000
      if (pingMs > 0) {
        this.pingTimer = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send('ping')
          }
        }, pingMs)
      }
    }

    this.ws.onmessage = (event) => {
      try {
        const fields = this.parseMessage(event.data)
        this.store.append(this.streamKey, fields)
        this.store.trim(this.streamKey, Date.now() - this.retentionMs)
        this.onMessage?.()
      } catch {
        // Write failure
      }
    }

    this.ws.onclose = () => {
      this.cleanup()
      if (!this.stopped && this.config.reconnect?.enabled !== false) {
        this.scheduleReconnect()
      } else {
        this.state = 'disconnected'
      }
    }

    this.ws.onerror = () => {
      this.state = 'error'
    }
  }

  private parseMessage(data: string | Buffer | ArrayBuffer): Record<string, string> {
    if (typeof data === 'string') {
      try {
        JSON.parse(data) // validate JSON
        return { payload: data, format: 'json' }
      } catch {
        return { payload: data, format: 'text' }
      }
    }
    const buf = data instanceof ArrayBuffer ? Buffer.from(data) : data as Buffer
    const fmt = this.config.binaryFormat ?? 'base64'
    if (fmt === 'json') {
      try {
        const text = buf.toString('utf-8')
        JSON.parse(text)
        return { payload: text, format: 'json' }
      } catch { /* fall through */ }
    }
    if (fmt === 'text') {
      return { payload: buf.toString('utf-8'), format: 'text' }
    }
    return { payload: buf.toString('base64'), format: 'base64' }
  }

  private scheduleReconnect() {
    const maxRetries = this.config.reconnect?.maxRetries ?? Infinity
    if (this.retryCount >= maxRetries) {
      this.state = 'error'
      this.error = `Max retries (${maxRetries}) exceeded`
      return
    }

    const base = this.config.reconnect?.initialDelayMs ?? 1000
    const max = this.config.reconnect?.maxDelayMs ?? 30000
    const delay = Math.min(base * Math.pow(2, this.retryCount), max)
    const jitter = delay * 0.2 * Math.random()

    this.retryCount++
    this.state = 'reconnecting'
    this.retryTimer = setTimeout(() => this.connect(), delay + jitter)
  }

  private cleanup() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null }
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null }
    this.cleanup()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.state = 'disconnected'
  }

  getStatus() {
    return { runtimeState: this.state, error: this.error }
  }
}
