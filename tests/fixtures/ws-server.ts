/**
 * Simulated WebSocket server — sends JSON sensor data on interval.
 */

export interface WsTestServer {
  start(): Promise<{ port: number }>
  stop(): void
  sentCount: number
  dropConnection(): void
}

export function createWsServer(opts: { intervalMs?: number } = {}): WsTestServer {
  const intervalMs = opts.intervalMs ?? 500
  let server: ReturnType<typeof Bun.serve> | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let count = 0
  let activeSockets = new Set<any>()

  return {
    get sentCount() { return count },
    async start() {
      server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch(req, srv) {
          if (srv.upgrade(req)) return
          return new Response('WebSocket server', { status: 200 })
        },
        websocket: {
          open(ws) { activeSockets.add(ws) },
          close(ws) { activeSockets.delete(ws) },
          message() {},
        },
      })

      timer = setInterval(() => {
        const payload = JSON.stringify({
          price: 50000 + Math.random() * 5000,
          symbol: 'BTC-USD',
          ts: Date.now(),
        })
        for (const ws of activeSockets) {
          try { ws.send(payload); count++ } catch { /* closed */ }
        }
      }, intervalMs)

      return { port: server.port }
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null }
      if (server) { server.stop(); server = null }
      activeSockets.clear()
    },
    dropConnection() {
      for (const ws of activeSockets) {
        ws.close()
      }
      activeSockets.clear()
    },
  }
}
