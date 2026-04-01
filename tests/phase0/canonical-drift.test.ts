/**
 * Drift detection tests — verify all doc surfaces reference all canonical data.
 * If these fail, a tool/command/operator was added to canonical but not propagated.
 */

import { test, expect } from 'bun:test'
import { TOOLS, CLI_COMMANDS, META } from '../../src/shared/canonical/index.js'
import { generateInstructions, generateHelpText, generateLlmHelp } from '../../src/shared/catalog-generators.js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// --- Generators → canonical ---

test('generateInstructions references all tool names', () => {
  const output = generateInstructions()
  for (const tool of TOOLS) {
    expect(output).toContain(tool.name)
  }
})

test('generateInstructions references all operators', () => {
  const output = generateInstructions()
  for (const op of META.operators) {
    expect(output).toContain(op)
  }
})

test('generateInstructions references all active source types', () => {
  const output = generateInstructions()
  for (const src of META.sourceTypes.filter((s) => s.status !== 'built-deferred')) {
    expect(output.toLowerCase()).toContain(src.type)
  }
})

test('generateInstructions references all data shapes', () => {
  const output = generateInstructions()
  for (const ds of META.dataShapes) {
    expect(output).toContain(ds.source)
  }
})

test('generateInstructions references all tips', () => {
  const output = generateInstructions()
  for (const tip of META.tips) {
    expect(output).toContain(tip)
  }
})

test('generateHelpText references all CLI command names', () => {
  const output = generateHelpText()
  for (const cmd of CLI_COMMANDS) {
    expect(output).toContain(cmd.name)
  }
})

test('generateLlmHelp includes all tools and commands', () => {
  const output = generateLlmHelp() as any
  expect(output.mcp_tools).toHaveLength(TOOLS.length)
  expect(output.commands).toHaveLength(CLI_COMMANDS.length)
  expect(output.setup.steps).toHaveLength(META.setupSteps.length)
  expect(output.setup.do_not).toHaveLength(META.doNotRules.length)
})

test('generateLlmHelp uses canonical description', () => {
  const output = generateLlmHelp() as any
  expect(output.description).toBe(META.description)
  expect(output.name).toBe(META.name)
})

// --- package.json → canonical ---

test('package.json description matches META.npmDescription', () => {
  const pkg = JSON.parse(readFileSync(resolve(import.meta.dir, '../../package.json'), 'utf-8'))
  expect(pkg.description).toBe(META.npmDescription)
})

// --- README → canonical ---

test('README references all tool names', () => {
  const readme = readFileSync(resolve(import.meta.dir, '../../README.md'), 'utf-8')
  for (const tool of TOOLS) {
    expect(readme).toContain(tool.name)
  }
})

test('README references all CLI command names', () => {
  const readme = readFileSync(resolve(import.meta.dir, '../../README.md'), 'utf-8')
  for (const cmd of CLI_COMMANDS) {
    // CLI commands appear as "livetap <name>" in README
    expect(readme).toContain(cmd.name)
  }
})

test('README references all operators', () => {
  const readme = readFileSync(resolve(import.meta.dir, '../../README.md'), 'utf-8')
  for (const op of META.operators) {
    expect(readme).toContain(op)
  }
})
