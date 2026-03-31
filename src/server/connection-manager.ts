/**
 * Connection Manager — creates, tracks, and destroys data source connections.
 */

import type Redis from 'ioredis'
import type { ConnectionConfig, ConnectionRecord, ConnectionStatus, Subscriber } from './types.js'
import { MqttSubscriber } from './connections/mqtt.js'
import { WebhookIngestor } from './connections/webhook.js'
import { WsSubscriber } from './connections/websocket.js'
import { FileSubscriber } from './connections/file.js'

function generateId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `conn_${hex}`
}

export class ConnectionManager {
  private connections = new Map<string, ConnectionRecord>()
  private redis: Redis
  private redisUrl: string

  constructor(redis: Redis, redisUrl: string) {
    this.redis = redis
    this.redisUrl = redisUrl
  }

  async create(config: ConnectionConfig, name?: string): Promise<ConnectionRecord> {
    const id = generateId()
    const streamKey = `livetap:stream:${id}`
    const createdAt = new Date().toISOString()

    const record: ConnectionRecord = {
      id,
      config,
      name,
      streamKey,
      createdAt,
      subscriber: null as unknown as Subscriber,
      msgCount: 0,
      msgCountAtLastSample: 0,
      msgPerSec: 0,
      bufferedCount: 0,
    }

    const onMessage = () => { record.msgCount++ }

    // Create appropriate subscriber
    if (config.type === 'mqtt') {
      record.subscriber = new MqttSubscriber({
        config,
        streamKey,
        redis: this.redis,
        onMessage,
      })
    } else if (config.type === 'webhook') {
      record.subscriber = new WebhookIngestor({
        streamKey,
        redis: this.redis,
        onMessage,
      })
    } else if (config.type === 'websocket') {
      record.subscriber = new WsSubscriber({
        config,
        streamKey,
        redis: this.redis,
        onMessage,
      })
    } else if (config.type === 'file') {
      record.subscriber = new FileSubscriber({
        config,
        streamKey,
        redis: this.redis,
        onMessage,
      })
    } else {
      throw new Error(`Unsupported connection type: ${(config as any).type}`)
    }

    await record.subscriber.start()

    // Throughput tracking (every 5s)
    record.throughputInterval = setInterval(() => {
      const delta = record.msgCount - record.msgCountAtLastSample
      record.msgPerSec = Math.round((delta / 5) * 10) / 10
      record.msgCountAtLastSample = record.msgCount
    }, 5000)

    // Buffered count tracking (every 5s)
    record.bufferedInterval = setInterval(async () => {
      try {
        record.bufferedCount = await this.redis.xlen(streamKey)
      } catch { /* ignore */ }
    }, 5000)

    this.connections.set(id, record)
    return record
  }

  list(): ConnectionStatus[] {
    return Array.from(this.connections.values()).map((r) => this.toStatus(r))
  }

  get(id: string): ConnectionRecord | undefined {
    return this.connections.get(id)
  }

  getStatus(id: string): ConnectionStatus | undefined {
    const r = this.connections.get(id)
    return r ? this.toStatus(r) : undefined
  }

  async destroy(id: string): Promise<boolean> {
    const record = this.connections.get(id)
    if (!record) return false

    if (record.throughputInterval) clearInterval(record.throughputInterval)
    if (record.bufferedInterval) clearInterval(record.bufferedInterval)

    await record.subscriber.stop()
    await this.redis.del(record.streamKey)
    this.connections.delete(id)
    return true
  }

  async destroyAll(): Promise<void> {
    for (const id of this.connections.keys()) {
      await this.destroy(id)
    }
  }

  /**
   * Get the WebhookIngestor for a connection (for routing ingest POSTs).
   */
  getWebhookIngestor(id: string): WebhookIngestor | null {
    const record = this.connections.get(id)
    if (!record || record.config.type !== 'webhook') return null
    return record.subscriber as WebhookIngestor
  }

  private toStatus(r: ConnectionRecord): ConnectionStatus {
    const sub = r.subscriber.getStatus()
    const base: ConnectionStatus = {
      connectionId: r.id,
      type: r.config.type,
      name: r.name,
      summary: this.buildSummary(r),
      streamKey: r.streamKey,
      createdAt: r.createdAt,
      msgPerSec: r.msgPerSec,
      bufferedCount: r.bufferedCount,
      runtimeState: sub.runtimeState,
      error: sub.error,
    }
    return base
  }

  private buildSummary(r: ConnectionRecord): string {
    switch (r.config.type) {
      case 'mqtt':
        return `mqtt://${r.config.broker}:${r.config.port}/${r.config.topics.join(',')}`
      case 'webhook':
        return `webhook ingest`
      case 'websocket':
        return r.config.url
      case 'file':
        return `file://${r.config.path}`
    }
  }
}
