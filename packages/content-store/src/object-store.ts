/**
 * The object store port (ADR-014).
 *
 * Six methods. Everything above this interface is Git; everything below it is
 * a key/value store whose keys happen to be SHA-1 hashes of their own values,
 * plus a named pointer with compare-and-swap. A Postgres or S3 backend
 * implements exactly this and nothing else.
 */

import type { WorkspaceId } from '@quill/domain'

export interface ObjectEntry {
  readonly oid: string
  /** The serialised object: `<type> <length>\0<body>`. */
  readonly bytes: Uint8Array
}

/**
 * The bytes an object store is given and hands back are **immutable**: an
 * object's name is the hash of its bytes, so mutating them would make the store
 * disagree with itself. A backend is free to keep the caller's array rather
 * than copying it, and free to hand the same array to every reader.
 */
export interface ObjectStore {
  /** The serialised object, or null when it is not stored here. */
  read(oid: string): Promise<Uint8Array | null>
  /** Content-addressed, so rewriting an object that exists is a no-op. */
  write(oid: string, bytes: Uint8Array): Promise<void>
  has(oid: string): Promise<boolean>
  /** A ref such as `refs/heads/main`, or null when it is unborn. */
  readRef(name: string): Promise<string | null>
  /**
   * Compare-and-swap a ref. Resolves true on success and false — without
   * writing — when the ref no longer holds `expected`. `expected` is null to
   * create an unborn ref. This is the only concurrency primitive the content
   * store has, and the only one a backend must get right.
   */
  casRef(name: string, expected: string | null, next: string): Promise<boolean>
  /** Write many objects; the unit of a publish's object writes. */
  writeBatch(entries: readonly ObjectEntry[]): Promise<void>
}

/**
 * One bare repository per workspace (ADR-014). The provider is how the content
 * store reaches a workspace's objects without knowing where they live.
 */
export interface ObjectStoreProvider {
  forWorkspace(workspaceId: WorkspaceId): Promise<ObjectStore>
}
