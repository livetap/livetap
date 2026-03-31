/**
 * Simulated WebSocket server — enhanced for Phase 6 hardening tests.
 * Supports: auth headers, handshake, connection dropping, binary frames,
 * connection rejection, and ping requirements.
 */

export interface WsServerOptions {
  intervalMs?: number
  requireHandshake?: string    // Wait for this message before sending data
  dropAfter?: number           // Drop connection after N messages sent
  rejectConnections?: number   // Reject first N connection attempts
  sendBinary?: boolean         // Send binary frames instead of text
}

export interface WsTestServer {
  start(): Promise<{ port: number }>
  stop(): void
  sentCount: number
  connectionCount: number
  dropConnection(): void
}

export function createWsServer(opts: WsServerOptions = {}): WsTestServer {
  const intervalMs = opts.intervalMs ?? 500
  let server: ReturnType<typeof Bun.serve> | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let sentCount = 0
  let connectionCount = 0
  let rejectRemaining = opts.rejectConnections ?? 0
  const activeSockets = new Set<any>()
  const handshakeReady = new Set<any>()

  return {
    get sentCount() { return sentCount },
    get connectionCount() { return connectionCount },
    async start() {
      server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch(req, srv) {
          // Reject connections if configured
          if (rejectRemaining > 0) {
            rejectRemaining--
            return new Response('rejected', { status: 403 })
          }
          if (srv.upgrade(req)) return
          return new Response('WebSocket server', { status: 200 })
        },
        websocket: {
          open(ws) {
            connectionCount++
            activeSockets.add(ws)
            // If no handshake required, mark as ready immediately
            if (!opts.requireHandshake) {
              handshakeReady.add(ws)
            }
          },
          close(ws) {
            activeSockets.delete(ws)
            handshakeReady.delete(ws)
          },
          message(ws, message) {
            // Check for handshake message
            if (opts.requireHandshake && !handshakeReady.has(ws)) {
              const text = typeof message === 'string' ? message : new TextDecoder().decode(message as ArrayBuffer)
              if (text === opts.requireHandshake) {
                handshakeReady.add(ws)
                ws.send(JSON.stringify({ type: 'subscribed', status: 'ok' }))
              }
            }
          },
        },
      })

      let msgsSentPerSocket = new Map<any, number>()

      timer = setInterval(() => {
        for (const ws of activeSockets) {
          // Only send to handshake-ready sockets
          if (!handshakeReady.has(ws)) continue

          // Check drop-after limit
          const sent = msgsSentPerSocket.get(ws) ?? 0
          if (opts.dropAfter && sent >= opts.dropAfter) {
            ws.close()
            activeSockets.delete(ws)
            handshakeReady.delete(ws)
            msgsSentPerSocket.delete(ws)
            continue
          }

          try {
            if (opts.sendBinary) {
              const data = JSON.stringify({ price: 50000 + Math.random() * 5000, symbol: 'BTC-USD', ts: Date.now() })
              ws.send(new TextEncoder().encode(data))
            } else {
              ws.send(JSON.stringify({ price: 50000 + Math.random() * 5000, symbol: 'BTC-USD', ts: Date.now() }))
            }
            sentCount++
            msgsSentPerSocket.set(ws, sent + 1)
          } catch { /* closed */ }
        }
      }, intervalMs)

      return { port: server.port }
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null }
      if (server) { server.stop(); server = null }
      activeSockets.clear()
      handshakeReady.clear()
    },
    dropConnection() {
      for (const ws of activeSockets) {
        ws.close()
      }
      activeSockets.clear()
      handshakeReady.clear()
    },
  }
}
