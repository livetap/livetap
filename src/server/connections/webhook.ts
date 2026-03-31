/**
 * Webhook Ingestor — HTTP endpoint that accepts POSTs and writes
 * payloads to a Redis Stream with rolling retention.
 */

import type Redis from 'ioredis'
import type { Subscriber, ConnectionStatus } from '../types.js'

export interface WebhookIngestorOpts {
  streamKey: string
  redis: Redis
  retentionMs?: number
  onMessage?: () => void
}

export class WebhookIngestor implements Subscriber {
  private streamKey: string
  private redis: Redis
  private retentionMs: number
  private onMessage: (() => void) | undefined
  private state: ConnectionStatus['runtimeState'] = 'disconnected'

  constructor(opts: WebhookIngestorOpts) {
    this.streamKey = opts.streamKey
    this.redis = opts.redis
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
    const fields: string[] = ['payload', body]
    if (headers?.['content-type']) fields.push('content_type', headers['content-type'])

    await this.redis.xadd(this.streamKey, '*', ...fields)
    const minId = Date.now() - this.retentionMs
    await this.redis.xtrim(this.streamKey, 'MINID', '~', minId.toString())
    this.onMessage?.()
  }

  getStatus() {
    return { runtimeState: this.state }
  }
}
