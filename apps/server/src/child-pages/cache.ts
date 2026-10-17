import type { ChildPagesCache, ChildPagesStructure, Clock } from '@quill/application'
import type { DocumentId } from '@quill/domain'

/**
 * What a child pages list remembers between requests (ADR-056): the subtree
 * under a page, keyed by the page and the depth, and never anything about
 * who read it — visibility is decided per request, so a new deny applies at
 * once.
 *
 * Bounded three ways, like the public site's cache (`public-site/cache.ts`):
 *
 * - **Events.** Creating, publishing, renaming, moving, nesting and deleting
 *   a document each arrive as an outbox event, and
 *   `invalidate-child-pages.ts` drops every entry the document is in, or is
 *   under, or that is under it (`invalidate`).
 * - **Time.** Anything no event reports is caught by a short time to live.
 * - **Size.** Oldest first, so a crawl of a large tree cannot grow the process.
 */

export interface ChildPagesCacheOptions {
  readonly clock: Clock
  /** Zero disables the cache outright. */
  readonly ttlMs: number
  readonly maxEntries?: number
}

export interface ServerChildPagesCache extends ChildPagesCache {
  /**
   * Drops every entry whose page is one of these, or which holds one of them
   * in its subtree or among its page's ancestors: what an event about those
   * documents can have changed.
   */
  invalidate(documentIds: Iterable<DocumentId>): void
  /** Everything, for an event this release cannot read. */
  clear(): void
}

export const CHILD_PAGES_CACHE_TTL_MS = 60_000

const DEFAULT_MAX_ENTRIES = 512

interface Entry {
  readonly structure: ChildPagesStructure
  readonly members: ReadonlySet<DocumentId>
  readonly at: number
}

export function createChildPagesCache(options: ChildPagesCacheOptions): ServerChildPagesCache {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  const entries = new Map<string, Entry>()

  return {
    find(key) {
      const entry = entries.get(key)
      if (entry === undefined) return undefined
      if (options.clock.now().getTime() - entry.at >= options.ttlMs) {
        entries.delete(key)
        return undefined
      }
      return entry.structure
    },
    remember(key, structure) {
      if (options.ttlMs <= 0) return
      entries.delete(key)
      entries.set(key, {
        structure,
        members: new Set(
          [...structure.ancestors, ...structure.descendants].map((document) => document.id),
        ),
        at: options.clock.now().getTime(),
      })
      for (const oldest of entries.keys()) {
        if (entries.size <= maxEntries) break
        entries.delete(oldest)
      }
    },
    invalidate(documentIds) {
      const changed = [...documentIds]
      for (const [key, entry] of entries) {
        if (changed.some((id) => entry.members.has(id))) entries.delete(key)
      }
    },
    clear() {
      entries.clear()
    },
  }
}
