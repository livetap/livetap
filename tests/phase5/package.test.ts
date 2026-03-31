import { test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dir, '..', '..')
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'))

test('package.json has required fields', () => {
  expect(pkg.name).toBe('livetap')
  expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/)
  expect(pkg.description).toBeTruthy()
  expect(pkg.license).toBe('MIT')
  expect(pkg.bin?.livetap).toBe('./bin/livetap.ts')
})

test('package.json has postinstall script', () => {
  expect(pkg.scripts?.postinstall).toContain('postinstall.ts')
})

test('package.json has keywords', () => {
  expect(pkg.keywords).toBeArray()
  expect(pkg.keywords).toContain('mqtt')
  expect(pkg.keywords).toContain('mcp')
  expect(pkg.keywords).toContain('claude-code')
})

test('package.json files array includes required paths', () => {
  expect(pkg.files).toContain('bin/')
  expect(pkg.files).toContain('src/')
  expect(pkg.files).toContain('README.md')
  expect(pkg.files).toContain('LICENSE')
  expect(pkg.files).toContain('scripts/postinstall.ts')
})

test('package.json files array excludes tests and docs', () => {
  expect(pkg.files).not.toContain('tests/')
  expect(pkg.files).not.toContain('docs/')
})

test('bin/livetap.ts exists and has shebang', () => {
  const binPath = resolve(ROOT, 'bin', 'livetap.ts')
  expect(existsSync(binPath)).toBe(true)
  const content = readFileSync(binPath, 'utf-8')
  expect(content.startsWith('#!/usr/bin/env bun')).toBe(true)
})

test('LICENSE file exists', () => {
  expect(existsSync(resolve(ROOT, 'LICENSE'))).toBe(true)
})

test('README.md exists and is non-empty', () => {
  const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf-8')
  expect(readme.length).toBeGreaterThan(100)
  expect(readme).toContain('livetap')
})

test('all dependencies in package.json are actually imported', () => {
  const deps = Object.keys(pkg.dependencies || {})
  // Check that each dep is actually used somewhere in src/
  for (const dep of deps) {
    const proc = Bun.spawnSync(['grep', '-r', dep, resolve(ROOT, 'src')], { stdout: 'pipe' })
    const out = new TextDecoder().decode(proc.stdout)
    expect(out.length).toBeGreaterThan(0)
  }
})
