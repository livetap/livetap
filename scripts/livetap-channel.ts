#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

// Create the MCP server and declare it as a channel
const mcp = new Server(
  { name: 'livetap', version: '0.0.1' },
  {
    capabilities: { experimental: { 'claude/channel': {} } },
    instructions:
      'Events from the livetap channel arrive as <channel source="livetap" protocol="..." topic="...">. ' +
      'These are live data stream events (MQTT, WebSocket, Kafka, etc). ' +
      'Analyze the data, detect anomalies, and take action if needed. One-way: no reply expected.',
  },
)

console.error('[livetap] connecting to Claude Code over stdio...')
await mcp.connect(new StdioServerTransport())
console.error('[livetap] connected. HTTP listener starting on :8788')

// HTTP endpoint on :8788 — accepts POSTs and pushes them as channel events
Bun.serve({
  port: 8788,
  hostname: '127.0.0.1',
  async fetch(req) {
    if (req.method !== 'POST') {
      return new Response('POST a JSON payload to push it into Claude Code', { status: 200 })
    }

    const body = await req.text()

    // Try to extract meta from JSON payload, fallback to raw text
    let content = body
    let meta: Record<string, string> = {}
    try {
      const json = JSON.parse(body)
      meta = {
        protocol: json.protocol || 'mqtt',
        topic: json.topic || 'unknown',
      }
      content = json.payload ? JSON.stringify(json.payload) : body
    } catch {
      meta = { protocol: 'raw', topic: 'http' }
    }

    try {
      await mcp.notification({
        method: 'notifications/claude/channel',
        params: { content, meta },
      })
      console.error(`[livetap] pushed: ${content.slice(0, 80)}`)
    } catch (err) {
      console.error(`[livetap] notification error:`, err)
      return new Response(`error: ${err}`, { status: 500 })
    }

    return new Response('ok — pushed to Claude Code')
  },
})
