/**
 * Embedded Redis lifecycle manager.
 * Uses the `redis-server` npm package which bundles a Redis binary.
 */

import RedisServer from 'redis-server'
import Redis from 'ioredis'

export interface RedisManager {
  port: number
  url: string
  client: Redis
  stop(): Promise<void>
}

/**
 * Start an embedded redis-server on the given port (or random free port).
 * Returns a manager with a connected ioredis client.
 */
export async function startRedis(preferredPort?: number): Promise<RedisManager> {
  const port = preferredPort ?? await findFreePort()

  const server = new RedisServer({ port })

  await new Promise<void>((resolve, reject) => {
    server.open((err: Error | null) => {
      if (err) reject(err)
      else resolve()
    })
  })

  const url = `redis://127.0.0.1:${port}`
  const client = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false })

  await client.ping()

  return {
    port,
    url,
    client,
    async stop() {
      client.disconnect()
      await new Promise<void>((resolve, reject) => {
        server.close((err: Error | null) => {
          if (err) reject(err)
          else resolve()
        })
      })
    },
  }
}

async function findFreePort(): Promise<number> {
  const server = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: { data() {} },
  })
  const port = server.port
  server.stop()
  return port
}
