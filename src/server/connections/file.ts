/**
 * File Tailing Subscriber — watches a file for new lines (tail -f behavior)
 * and writes each line to a stream with rolling retention.
 * Auto-detects JSON vs plain text per line.
 */

import { watch, type FSWatcher } from 'fs'
import { open, stat, type FileHandle } from 'fs/promises'
import type { StreamStore } from '../stream-store.js'
import type { FileConnectionConfig, Subscriber, ConnectionStatus } from '../types.js'

export interface FileSubscriberOpts {
  config: FileConnectionConfig
  streamKey: string
  store: StreamStore
  retentionMs?: number
  onMessage?: () => void
}

export class FileSubscriber implements Subscriber {
  private config: FileConnectionConfig
  private streamKey: string
  private store: StreamStore
  private retentionMs: number
  private onMessage: (() => void) | undefined
  private state: ConnectionStatus['runtimeState'] = 'disconnected'
  private error?: string
  private fileHandle: FileHandle | null = null
  private watcher: FSWatcher | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private offset = 0
  private buffer = ''
  private stopped = false

  constructor(opts: FileSubscriberOpts) {
    this.config = opts.config
    this.streamKey = opts.streamKey
    this.store = opts.store
    this.retentionMs = opts.retentionMs ?? 5 * 60 * 1000
    this.onMessage = opts.onMessage
  }

  async start(): Promise<void> {
    this.stopped = false

    try {
      // Open file and seek to end (tail -f: new lines only)
      const stats = await stat(this.config.path)
      this.offset = stats.size
      this.fileHandle = await open(this.config.path, 'r')
      this.state = 'connected'
      this.error = undefined

      // Watch for changes with fs.watch + fallback poll
      try {
        this.watcher = watch(this.config.path, () => this.readNewLines())
      } catch {
        // fs.watch not available on all platforms/filesystems
      }

      // Poll every 1s as fallback (fs.watch can miss events)
      this.pollTimer = setInterval(() => this.readNewLines(), 1000)

    } catch (err) {
      this.state = 'error'
      this.error = (err as Error).message
      throw err
    }
  }

  private async readNewLines() {
    if (this.stopped || !this.fileHandle) return

    try {
      const stats = await stat(this.config.path)
      if (stats.size <= this.offset) return // no new data

      const readSize = stats.size - this.offset
      const buf = Buffer.alloc(readSize)
      const { bytesRead } = await this.fileHandle.read(buf, 0, readSize, this.offset)
      this.offset += bytesRead

      this.buffer += buf.toString('utf-8', 0, bytesRead)

      // Split into complete lines
      const lines = this.buffer.split('\n')
      this.buffer = lines.pop() ?? '' // keep incomplete last line in buffer

      for (const line of lines) {
        if (!line.trim()) continue // skip empty lines

        // Auto-detect: try JSON, fall back to text
        let fields: Record<string, string>
        try {
          JSON.parse(line)
          fields = { payload: line, format: 'json' }
        } catch {
          fields = { payload: line, format: 'text' }
        }

        this.store.append(this.streamKey, fields)
        this.store.trim(this.streamKey, Date.now() - this.retentionMs)
        this.onMessage?.()
      }
    } catch (err) {
      // File may have been deleted/rotated
      this.error = (err as Error).message
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.watcher) { this.watcher.close(); this.watcher = null }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
    if (this.fileHandle) { await this.fileHandle.close(); this.fileHandle = null }
    this.state = 'disconnected'
  }

  getStatus() {
    return { runtimeState: this.state, error: this.error }
  }
}
