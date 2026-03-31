#!/usr/bin/env bun
/**
 * Postinstall script — auto-configures .mcp.json for Claude Code.
 * Runs after `bun add livetap` or `npm install livetap`.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const MCP_ENTRY = {
  livetap: {
    command: 'bun',
    args: [resolve(import.meta.dir, '..', 'src', 'mcp', 'channel.ts')],
  },
}

function findProjectRoot(): string {
  // If we're inside node_modules, walk up past it to find the project root
  const scriptDir = resolve(import.meta.dir)
  const nmIdx = scriptDir.lastIndexOf('node_modules')
  if (nmIdx !== -1) {
    const root = scriptDir.slice(0, nmIdx).replace(/\/$/, '')
    if (existsSync(resolve(root, 'package.json'))) return root
  }
  // Fallback to cwd (e.g. when running postinstall directly for testing)
  return process.cwd()
}

function run() {
  // Skip in CI or when explicitly disabled
  if (process.env.CI || process.env.LIVETAP_SKIP_POSTINSTALL) return

  const root = findProjectRoot()
  const mcpPath = resolve(root, '.mcp.json')

  let config: any = {}
  if (existsSync(mcpPath)) {
    try {
      config = JSON.parse(readFileSync(mcpPath, 'utf-8'))
    } catch {
      console.warn('\n  ⚠ .mcp.json exists but is malformed. Skipping auto-config.')
      console.warn('    Add the livetap entry manually (see below).\n')
      printManualInstructions()
      return
    }
  }

  // Don't overwrite if livetap entry already exists
  if (config.mcpServers?.livetap) {
    console.log('\n  ✓ livetap already configured in .mcp.json\n')
    printRestartInstructions()
    return
  }

  // Add livetap entry
  if (!config.mcpServers) config.mcpServers = {}
  config.mcpServers.livetap = MCP_ENTRY.livetap
  writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n')

  console.log('\n  ✓ livetap added to .mcp.json\n')
  printRestartInstructions()
}

function printRestartInstructions() {
  console.log('  To enable live data streaming in Claude Code, restart with:\n')
  console.log('    claude --dangerously-load-development-channels server:livetap\n')
  console.log('  Then ask Claude: "Connect to mqtt://broker.emqx.io:1883/sensors/#"\n')
}

function printManualInstructions() {
  console.log('  Add to .mcp.json:\n')
  console.log('    ' + JSON.stringify({ mcpServers: MCP_ENTRY }, null, 2).split('\n').join('\n    ') + '\n')
}

run()
