/**
 * Two more ObjectStore implementations, to separate engine cost from I/O cost
 * and to prove the interface is the only thing a Postgres/S3 backend needs.
 *
 * MemoryObjectStore  — the shape a key/value backend (S3, Postgres bytea) has.
 * CachingObjectStore — read-through cache in front of any store. Trees and
 *                      commits are immutable, so caching them is always safe;
 *                      refs are never cached.
 */

import type { GitObjectType, ObjectStore, RawObject } from './git-core.ts'

export class MemoryObjectStore implements ObjectStore {
  private objects = new Map<string, RawObject>()
  private refs = new Map<string, string>()
  /** Counts, so a bench can report round trips a real backend would make. */
  reads = 0
  writes = 0
  refReads = 0
  casAttempts = 0
  casFailures = 0

  async read(oid: string): Promise<RawObject | null> {
    this.reads++
    return this.objects.get(oid) ?? null
  }

  async write(oid: string, type: GitObjectType, body: Buffer): Promise<void> {
    this.writes++
    if (!this.objects.has(oid)) this.objects.set(oid, { type, body })
  }

  async has(oid: string): Promise<boolean> {
    return this.objects.has(oid)
  }

  async readRef(name: string): Promise<string | null> {
    this.refReads++
    return this.refs.get(name) ?? null
  }

  async casRef(name: string, expected: string | null, next: string): Promise<boolean> {
    this.casAttempts++
    const actual = this.refs.get(name) ?? null
    if (actual !== expected) {
      this.casFailures++
      return false
    }
    this.refs.set(name, next)
    return true
  }

  get objectCount(): number {
    return this.objects.size
  }

  get byteCount(): number {
    let n = 0
    for (const o of this.objects.values()) n += o.body.length
    return n
  }

  resetCounters(): void {
    this.reads = 0
    this.writes = 0
    this.refReads = 0
    this.casAttempts = 0
    this.casFailures = 0
  }
}

export class CachingObjectStore implements ObjectStore {
  private inner: ObjectStore
  private cache = new Map<string, RawObject>()
  private max: number
  hits = 0
  misses = 0

  constructor(inner: ObjectStore, max = 20_000) {
    this.inner = inner
    this.max = max
  }

  private remember(oid: string, o: RawObject): void {
    // Only cache trees and commits: blobs are large and read once.
    if (o.type === 'blob') return
    if (this.cache.size >= this.max) {
      const first = this.cache.keys().next().value
      if (first !== undefined) this.cache.delete(first)
    }
    this.cache.set(oid, o)
  }

  async read(oid: string): Promise<RawObject | null> {
    const hit = this.cache.get(oid)
    if (hit) {
      this.hits++
      return hit
    }
    this.misses++
    const o = await this.inner.read(oid)
    if (o) this.remember(oid, o)
    return o
  }

  async write(oid: string, type: GitObjectType, body: Buffer): Promise<void> {
    await this.inner.write(oid, type, body)
    this.remember(oid, { type, body })
  }

  has(oid: string): Promise<boolean> {
    return this.inner.has(oid)
  }

  readRef(name: string): Promise<string | null> {
    return this.inner.readRef(name)
  }

  casRef(name: string, expected: string | null, next: string): Promise<boolean> {
    return this.inner.casRef(name, expected, next)
  }
}
