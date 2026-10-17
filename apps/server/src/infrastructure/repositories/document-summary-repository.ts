import { inArray, sql } from 'drizzle-orm'

import type { DocumentSummaryRepository } from '@quill/application'
import { documentId } from '@quill/domain'

import { documentSearch } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'

/** As long as a projected summary is (`SUMMARY_LIMIT` in `@quill/markdown`). */
const FALLBACK_LENGTH = 240

/**
 * What a child pages list shows under each title (ADR-056), read from the
 * search projection of each page's published head: one query for any number
 * of pages, and nothing read from the content store.
 *
 * A row projected before the summary existed has none; its indexed body's
 * first line — the first paragraph, or the first block of prose — stands in
 * until the page is republished or reindexed.
 */
export function createDocumentSummaryRepository(db: DrizzleClient): DocumentSummaryRepository {
  return {
    async listByIds(ids) {
      if (ids.length === 0) return []
      const rows = await db
        .select({
          documentId: documentSearch.documentId,
          summary: sql<
            string | null
          >`coalesce(${documentSearch.summary}, nullif(left(split_part(${documentSearch.body}, E'\n', 1), ${FALLBACK_LENGTH}), ''))`,
          icon: documentSearch.icon,
        })
        .from(documentSearch)
        .where(inArray(documentSearch.documentId, [...ids]))
      return rows.map((row) => ({
        documentId: documentId(row.documentId),
        summary: row.summary,
        icon: row.icon,
      }))
    },
  }
}
