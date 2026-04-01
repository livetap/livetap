/**
 * In-memory stream store — replaces Redis for stream buffering.
 * Provides append, range, trim, len, del, and subscribe (EventEmitter).
 */

import { EventEmitter } from 'events'

export interface StreamEntry {
  id: string // "{timestamp}-{seq}"
  fields: Record<string, string>
}

export class StreamStore {
  private streams = new Map<string, StreamEntry[]>()
  private seqCounters = new Map<string, number>()
  private emitter = new EventEmitter()

  constructor() {
    this.emitter.setMaxListeners(1000)
  }

  /**
   * Append an entry to a stream. Returns the generated ID.
   * Equivalent to Redis XADD streamKey * field1 val1 field2 val2
   */
  append(streamKey: string, fields: Record<string, string>): string {
    const ts = Date.now()
    const seq = this.seqCounters.get(streamKey) ?? 0
    this.seqCounters.set(streamKey, seq + 1)
    const id = `${ts}-${seq}`

    const entry: StreamEntry = { id, fields }

    let stream = this.streams.get(streamKey)
    if (!stream) {
      stream = []
      this.streams.set(streamKey, stream)
    }
    stream.push(entry)

    this.emitter.emit(streamKey, entry)
    return id
  }

  /**
   * Read entries from a stream in a time range.
   * Equivalent to Redis XRANGE streamKey since + COUNT count
   */
  range(streamKey: string, sinceMs: number, count?: number): StreamEntry[] {
    const stream = this.streams.get(streamKey)
    if (!stream) return []

    const sinceStr = String(sinceMs)
    const filtered = stream.filter((e) => {
      const entryTs = e.id.split('-')[0]
      return entryTs >= sinceStr
    })

    return count ? filtered.slice(0, count) : filtered
  }

  /**
   * Trim entries older than minTs.
   * Equivalent to Redis XTRIM streamKey MINID ~ minTs
   */
  trim(streamKey: string, minTs: number): void {
    const stream = this.streams.get(streamKey)
    if (!stream) return

    const minStr = String(minTs)
    // Find first entry that's >= minTs
    let cutIndex = 0
    for (let i = 0; i < stream.length; i++) {
      const entryTs = stream[i].id.split('-')[0]
      if (entryTs >= minStr) break
      cutIndex = i + 1
    }
    if (cutIndex > 0) {
      stream.splice(0, cutIndex)
    }
  }

  /**
   * Get entry count for a stream.
   * Equivalent to Redis XLEN streamKey
   */
  len(streamKey: string): number {
    return this.streams.get(streamKey)?.length ?? 0
  }

  /**
   * Delete a stream entirely.
   * Equivalent to Redis DEL streamKey
   */
  del(streamKey: string): void {
    this.streams.delete(streamKey)
    this.seqCounters.delete(streamKey)
    this.emitter.removeAllListeners(streamKey)
  }

  /**
   * Subscribe to new entries on a stream.
   * Replaces Redis XREAD BLOCK — zero-latency, event-driven.
   * Returns an unsubscribe function.
   */
  subscribe(streamKey: string, callback: (entry: StreamEntry) => void): () => void {
    this.emitter.on(streamKey, callback)
    return () => {
      this.emitter.off(streamKey, callback)
    }
  }

  /**
   * Check if a stream exists.
   */
  has(streamKey: string): boolean {
    return this.streams.has(streamKey)
  }

  /**
   * Stop the store — clean up all data and listeners.
   */
  stop(): void {
    this.streams.clear()
    this.seqCounters.clear()
    this.emitter.removeAllListeners()
  }
}
