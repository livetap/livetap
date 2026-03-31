/**
 * livetap setup — creates .mcp.json and prints restart instructions.
 * Works with both npm and bun. Node-compatible (no bun APIs).
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

export async function run(_args: string[]) {
  const root = process.cwd()
  const mcpPath = resolve(root, '.mcp.json')

  // Find the channel.ts path relative to where livetap is installed
  const channelPaths = [
    resolve(root, 'node_modules', 'livetap', 'src', 'mcp', 'channel.ts'),
    resolve(root, 'node_modules', '.store', 'livetap', 'src', 'mcp', 'channel.ts'),
    // Local dev: running from the repo itself
    resolve(root, 'src', 'mcp', 'channel.ts'),
  ]

  let channelPath = channelPaths.find((p) => existsSync(p))
  if (!channelPath) {
    // Try to resolve from require
    try {
      const pkg = require.resolve('livetap/package.json')
      channelPath = resolve(pkg, '..', 'src', 'mcp', 'channel.ts')
      if (!existsSync(channelPath)) channelPath = undefined
    } catch { /* not found */ }
  }

  if (!channelPath) {
    console.error('Error: Could not find livetap channel.ts. Is livetap installed?')
    console.error('Run: npm install livetap')
    process.exit(1)
  }

  const mcpEntry = {
    livetap: {
      command: 'bun',
      args: [channelPath],
    },
  }

  // Read or create .mcp.json
  let config: any = {}
  if (existsSync(mcpPath)) {
    try {
      config = JSON.parse(readFileSync(mcpPath, 'utf-8'))
    } catch {
      console.error('Warning: .mcp.json exists but is malformed. Overwriting.')
    }
  }

  if (config.mcpServers?.livetap) {
    console.log('✓ livetap already configured in .mcp.json')
  } else {
    if (!config.mcpServers) config.mcpServers = {}
    config.mcpServers.livetap = mcpEntry.livetap
    writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n')
    console.log('✓ .mcp.json created with livetap MCP server entry')
  }

  console.log('')
  console.log('→ Next step: restart Claude Code with:')
  console.log('  claude --dangerously-load-development-channels server:livetap --continue')
  console.log('')
  console.log('→ After restart, MCP tools are available. Ask Claude to:')
  console.log('  "Connect to mqtt://broker.emqx.io:1883/sensors/#"')
  console.log('  "Watch for temperature > 50 and summarize alerts"')
}
