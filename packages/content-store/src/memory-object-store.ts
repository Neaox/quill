/**
 * In-memory {@link ObjectStore}: the shape a key/value backend (S3, a Postgres
 * `bytea` column) has, with none of the latency. It is what makes the whole
 * content store unit-testable at roughly 0.1 ms per publish (ADR-014), and it
 * is the store the application layer's own unit tests should use.
 *
 * It keeps and returns the caller's own array rather than copying it, which is
 * the contract every backend shares (see {@link ObjectStore}): object bytes are
 * immutable, because their name is their hash, so a copy would buy nothing but
 * garbage. A caller that mutates bytes it has written or read has corrupted a
 * content-addressed store, whichever backend is underneath.
 */

import type { WorkspaceId } from '@quill/domain'
import type { ObjectEntry, ObjectStore, ObjectStoreProvider } from './object-store.ts'

export class MemoryObjectStore implements ObjectStore {
  readonly #objects = new Map<string, Uint8Array>()
  readonly #refs = new Map<string, string>()

  async read(oid: string): Promise<Uint8Array | null> {
    return this.#objects.get(oid) ?? null
  }

  async write(oid: string, bytes: Uint8Array): Promise<void> {
    if (!this.#objects.has(oid)) this.#objects.set(oid, bytes)
  }

  async has(oid: string): Promise<boolean> {
    return this.#objects.has(oid)
  }

  async readRef(name: string): Promise<string | null> {
    return this.#refs.get(name) ?? null
  }

  async casRef(name: string, expected: string | null, next: string): Promise<boolean> {
    if ((this.#refs.get(name) ?? null) !== expected) return false
    this.#refs.set(name, next)
    return true
  }

  async writeBatch(entries: readonly ObjectEntry[]): Promise<void> {
    for (const entry of entries) await this.write(entry.oid, entry.bytes)
  }

  /** Loose-object count, for tests that assert on the cost of a publish. */
  get size(): number {
    return this.#objects.size
  }
}

/** Keeps one {@link MemoryObjectStore} per workspace for the life of the process. */
export class MemoryObjectStoreProvider implements ObjectStoreProvider {
  readonly #stores = new Map<string, MemoryObjectStore>()

  async forWorkspace(workspaceId: WorkspaceId): Promise<MemoryObjectStore> {
    const existing = this.#stores.get(workspaceId)
    if (existing !== undefined) return existing
    const created = new MemoryObjectStore()
    this.#stores.set(workspaceId, created)
    return created
  }
}
