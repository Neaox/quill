import { eq } from 'drizzle-orm'

import type {
  RenderCacheRepository,
  RenderCacheRow,
  RenderedContent,
  SaveRenderInput,
} from '@quill/application'
import type { DocumentId } from '@quill/domain'

import { renderCache } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'

/**
 * The shared render cache (ADR-031).
 *
 * Entries are keyed by the hash of everything the body was rendered from and
 * by the render version, so nothing is ever invalidated: a new revision, and a
 * rename in a document this one links to, each simply produce a new key, and
 * the old row is collected by age of last read. `document_id` is provenance —
 * which document first produced the entry — and never an identity: two
 * documents that render the same input share the row.
 */

function toRenderRow(row: typeof renderCache.$inferSelect): RenderCacheRow {
  return {
    key: row.key,
    documentId: row.documentId as DocumentId,
    contentHash: row.contentHash,
    renderVersion: row.renderVersion,
    content: row.content as RenderedContent,
    createdAt: row.createdAt,
    lastReadAt: row.lastReadAt,
  }
}

export function createRenderCacheRepository(db: DrizzleClient): RenderCacheRepository {
  return {
    /** Reads and stamps in one statement, so nothing pays two round trips to record a read. */
    async find(key: string, now: Date): Promise<RenderCacheRow | null> {
      const rows = await db
        .update(renderCache)
        .set({ lastReadAt: now })
        .where(eq(renderCache.key, key))
        .returning()
      const row = rows[0]
      return row === undefined ? null : toRenderRow(row)
    },

    async save(input: SaveRenderInput): Promise<void> {
      await db
        .insert(renderCache)
        .values({
          key: input.key,
          documentId: input.documentId,
          contentHash: input.contentHash,
          renderVersion: input.renderVersion,
          content: input.content,
          createdAt: input.now,
          lastReadAt: input.now,
        })
        .onConflictDoUpdate({
          target: renderCache.key,
          set: { content: input.content, lastReadAt: input.now },
        })
    },
  }
}
