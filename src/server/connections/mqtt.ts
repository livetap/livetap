/**
 * MQTT Subscriber — connects to an MQTT broker and writes messages
 * to a Redis Stream with rolling retention.
 */

import mqtt from 'mqtt'
import type Redis from 'ioredis'
import type { MqttConnectionConfig, Subscriber, ConnectionStatus } from '../types.js'

export interface MqttSubscriberOpts {
  config: MqttConnectionConfig
  streamKey: string
  redis: Redis
  retentionMs?: number
  onMessage?: () => void
}

export class MqttSubscriber implements Subscriber {
  private client: mqtt.MqttClient | null = null
  private config: MqttConnectionConfig
  private streamKey: string
  private redis: Redis
  private retentionMs: number
  private onMessage: (() => void) | undefined
  private state: ConnectionStatus['runtimeState'] = 'disconnected'
  private error?: string

  constructor(opts: MqttSubscriberOpts) {
    this.config = opts.config
    this.streamKey = opts.streamKey
    this.redis = opts.redis
    this.retentionMs = opts.retentionMs ?? 5 * 60 * 1000
    this.onMessage = opts.onMessage
  }

  async start(): Promise<void> {
    const { broker, port, tls, credentials, topics } = this.config
    const protocol = tls ? 'mqtts' : 'mqtt'
    const url = `${protocol}://${broker}:${port}`

    this.state = 'disconnected'

    this.client = mqtt.connect(url, {
      username: credentials.username || undefined,
      password: credentials.password || undefined,
      rejectUnauthorized: tls,
    })

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.state = 'error'
        this.error = 'Connection timeout'
        reject(new Error(`MQTT connection to ${url} timed out`))
      }, 15_000)

      this.client!.on('connect', () => {
        clearTimeout(timeout)
        this.state = 'connected'
        this.error = undefined
        this.client!.subscribe(topics, (err) => {
          if (err) {
            this.state = 'error'
            this.error = err.message
            reject(err)
          } else {
            resolve()
          }
        })
      })

      this.client!.on('error', (err) => {
        this.state = 'error'
        this.error = err.message
      })

      this.client!.on('reconnect', () => {
        this.state = 'reconnecting'
      })

      this.client!.on('message', async (topic, payload) => {
        try {
          await this.redis.xadd(this.streamKey, '*', 'topic', topic, 'payload', payload.toString())
          const minId = Date.now() - this.retentionMs
          await this.redis.xtrim(this.streamKey, 'MINID', '~', minId.toString())
          this.onMessage?.()
        } catch {
          // Redis write failure — log but don't crash
        }
      })
    })
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.endAsync()
      this.client = null
    }
    this.state = 'disconnected'
  }

  getStatus() {
    return { runtimeState: this.state, error: this.error }
  }
}
