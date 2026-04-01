#!/usr/bin/env bun
/**
 * livetap MCP Channel Proxy
 *
 * Thin MCP server spawned by Claude Code as a subprocess (stdio transport).
 * - Declares claude/channel capability for push notifications
 * - Proxies all tool calls to the livetap daemon on :8788
 * - Holds SSE connection to daemon /events for alert delivery
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { readFileSync } from 'fs'
import { registerTools } from './tools.js'
import { generateInstructions } from '../shared/catalog-generators.js'

const PKG = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url).pathname, 'utf-8'))

const DAEMON_PORT = parseInt(process.env.LIVETAP_PORT || '8788')
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`

const INSTRUCTIONS = generateInstructions()

async function waitForDaemon(maxWaitMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${DAEMON_URL}/status`)
      if (res.ok) return true
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

async function autoStartDaemon(): Promise<boolean> {
  // Check if already running
  try {
    const res = await fetch(`${DAEMON_URL}/status`)
    if (res.ok) return true
  } catch { /* not running */ }

  // Auto-start via CLI (single code path — resolves paths correctly from any CWD)
  const startScript = new URL('../../bin/livetap.ts', import.meta.url).pathname
  console.error('[livetap-mcp] Daemon not running, auto-starting...')
  const proc = Bun.spawn(['bun', startScript, 'start'], {
    env: { ...process.env, LIVETAP_PORT: String(DAEMON_PORT) },
    stdout: 'ignore',
    stderr: 'ignore',
  })
  proc.unref()

  return waitForDaemon()
}

async function connectToSSE(mcp: Server) {
  try {
    const res = await fetch(`${DAEMON_URL}/events`)
    if (!res.ok || !res.body) {
      // Daemon not ready — retry
      setTimeout(() => connectToSSE(mcp), 5000)
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          try {
            const event = JSON.parse(data)
            await mcp.notification({
              method: 'notifications/claude/channel',
              params: {
                content: JSON.stringify(event.payload ?? event),
                meta: {
                  type: event.type ?? 'alert',
                  ...(event.connectionId && { connection: event.connectionId }),
                  ...(event.watcherId && { watcher: event.watcherId }),
                },
              },
            })
          } catch { /* malformed event */ }
        }
      }
    }
    // Clean disconnect (daemon died or restarted) — retry
    setTimeout(() => connectToSSE(mcp), 5000)
  } catch {
    // SSE connection error — retry after delay
    setTimeout(() => connectToSSE(mcp), 5000)
  }
}

async function main() {
  const daemonReady = await autoStartDaemon()
  if (!daemonReady) {
    console.error('[livetap-mcp] WARNING: Could not connect to daemon. Tools will auto-retry on first call.')
  }

  const mcp = new Server(
    { name: 'LiveTap', version: PKG.version },
    {
      capabilities: {
        experimental: { 'claude/channel': {} },
        tools: {},
      },
      instructions: INSTRUCTIONS,
    },
  )

  registerTools(mcp, DAEMON_URL)

  await mcp.connect(new StdioServerTransport())
  console.error('[livetap-mcp] MCP channel proxy connected')

  // Start SSE listener for alert delivery (non-blocking)
  connectToSSE(mcp)
}

// Prevent unhandled errors from crashing the proxy process
process.on('unhandledRejection', (err) => {
  console.error('[livetap-mcp] unhandled rejection:', err)
})
process.on('uncaughtException', (err) => {
  console.error('[livetap-mcp] uncaught exception:', err)
})

main()
