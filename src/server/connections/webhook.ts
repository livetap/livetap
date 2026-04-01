/**
 * Webhook Ingestor — HTTP endpoint that accepts POSTs and writes
 * payloads to a stream with rolling retention.
 */

import type { StreamStore } from '../stream-store.js'
import type { Subscriber, ConnectionStatus } from '../types.js'

export interface WebhookIngestorOpts {
  streamKey: string
  store: StreamStore
  retentionMs?: number
  onMessage?: () => void
}

export class WebhookIngestor implements Subscriber {
  private streamKey: string
  private store: StreamStore
  private retentionMs: number
  private onMessage: (() => void) | undefined
  private state: ConnectionStatus['runtimeState'] = 'disconnected'

  constructor(opts: WebhookIngestorOpts) {
    this.streamKey = opts.streamKey
    this.store = opts.store
    this.retentionMs = opts.retentionMs ?? 5 * 60 * 1000
    this.onMessage = opts.onMessage
  }

  async start(): Promise<void> {
    this.state = 'connected'
  }

  async stop(): Promise<void> {
    this.state = 'disconnected'
  }

  /**
   * Ingest a webhook payload. Called by the HTTP API route handler.
   */
  async ingest(body: string, headers?: Record<string, string>): Promise<void> {
    const fields: Record<string, string> = { payload: body }
    if (headers?.['content-type']) fields.content_type = headers['content-type']

    this.store.append(this.streamKey, fields)
    this.store.trim(this.streamKey, Date.now() - this.retentionMs)
    this.onMessage?.()
  }

  getStatus() {
    return { runtimeState: this.state }
  }
}
