import { createHash } from 'node:crypto'

import { concatChunks, type BlobRef, type BlobStore } from '../ports/blob-store.ts'

/**
 * A `BlobStore` in a `Map`, for tests and for the server harness.
 *
 * It is the real content-addressed behaviour — the same bytes are the same
 * object, a partial write is never published, a missing hash is `null` — with
 * the disk taken out, so a use-case test can exercise an upload end to end
 * without a directory to clean up. The adapters' own conformance is proved
 * against them (`apps/server/src/infrastructure/blob`).
 */
export interface InMemoryBlobStore extends BlobStore {
  /** What is stored, by hash, so a test can assert on the bytes that landed. */
  readonly objects: ReadonlyMap<string, Uint8Array>
  /** Removes everything, for a test that wants a blob to have gone missing. */
  clear(): void
}

export function createInMemoryBlobStore(): InMemoryBlobStore {
  const objects = new Map<string, Uint8Array>()

  return {
    objects,

    async put(chunks, contentType): Promise<BlobRef> {
      const hash = createHash('sha256')
      const collected: Uint8Array[] = []
      for await (const chunk of chunks) {
        hash.update(chunk)
        collected.push(chunk)
      }
      // Collected first and stored last, so a stream that refuses partway
      // through leaves nothing behind — which is what the adapters achieve
      // with a temporary file and a rename.
      const bytes = concatChunks(collected)
      const digest = hash.digest('hex')
      objects.set(digest, bytes)
      return { hash: digest, size: bytes.length, contentType }
    },

    async open(hash): Promise<AsyncIterable<Uint8Array> | null> {
      const bytes = objects.get(hash)
      if (bytes === undefined) return null
      return (async function* one() {
        yield bytes
      })()
    },

    async has(hash): Promise<boolean> {
      return objects.has(hash)
    },

    async delete(hash): Promise<void> {
      objects.delete(hash)
    },

    clear(): void {
      objects.clear()
    },
  }
}
