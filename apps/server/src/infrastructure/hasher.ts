import { createHash } from 'node:crypto'

import type { Hasher } from '@quill/application'

/**
 * The `Hasher` port, on SHA-256 (ADR-031).
 *
 * Hashing is infrastructure the way the clock is: the application layer says
 * what it needs a hash of and never imports `node:crypto`, which is what keeps
 * the use cases runnable anywhere and testable with a hash a person can read.
 * The algorithm is part of the cache key's meaning, so changing it is bumping
 * `RENDER_VERSION`.
 */
export function createHasher(): Hasher {
  return {
    contentHash(text: string): string {
      return createHash('sha256').update(text, 'utf8').digest('hex')
    },
  }
}
