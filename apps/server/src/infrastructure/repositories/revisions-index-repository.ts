import { and, desc, eq, lt, or, sql } from 'drizzle-orm'

import type {
  AppendRevisionInput,
  HistoryPage,
  RevisionIndexRow,
  RevisionsIndexRepository,
} from '@quill/application'
import type { DocumentId, RevisionId, WorkspaceId } from '@quill/domain'

import { revisionsIndex } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'
import { requireRow } from '../db/rows.ts'

/**
 * The revisions index (ADR-014).
 *
 * History from the repository alone is O(total revisions) — tens of seconds on
 * a large workspace — so this table is on the critical path for history and
 * compare, not a cache. It can be rebuilt from the commit trailers, which is
 * the recovery procedure.
 */

function toRevisionRow(row: typeof revisionsIndex.$inferSelect): RevisionIndexRow {
  return {
    id: row.id,
    documentId: row.documentId as DocumentId,
    workspaceId: row.workspaceId as WorkspaceId,
    revision: row.revision as RevisionId,
    authorName: row.authorName,
    authorEmail: row.authorEmail,
    timestamp: row.timestamp,
    summary: row.summary,
    changeNote: row.changeNote,
    createdAt: row.createdAt,
  }
}

export function createRevisionsIndexRepository(db: DrizzleClient): RevisionsIndexRepository {
  return {
    /**
     * Idempotent on `(document_id, revision)`.
     *
     * A publish writes to the content store first and records here second, so
     * a publish that is retried after failing in between must not leave two
     * history entries for one revision. The unique index is what guarantees
     * that under concurrency; `DO NOTHING` is what turns it into an answer
     * rather than an error, and the row already there is returned.
     */
    async append(input: AppendRevisionInput): Promise<RevisionIndexRow> {
      const rows = await db
        .insert(revisionsIndex)
        .values({
          id: input.id,
          documentId: input.documentId,
          workspaceId: input.workspaceId,
          revision: input.revision,
          authorName: input.authorName,
          authorEmail: input.authorEmail,
          timestamp: input.timestamp,
          summary: input.summary,
          changeNote: input.changeNote,
          createdAt: input.now,
        })
        .onConflictDoNothing({ target: [revisionsIndex.documentId, revisionsIndex.revision] })
        .returning()

      const inserted = rows[0]
      if (inserted !== undefined) return toRevisionRow(inserted)
      const existing = await db
        .select()
        .from(revisionsIndex)
        .where(
          and(
            eq(revisionsIndex.documentId, input.documentId),
            eq(revisionsIndex.revision, input.revision),
          ),
        )
        .limit(1)
      return toRevisionRow(
        requireRow(existing[0], 'append: a conflicting revision row must exist to have conflicted'),
      )
    },

    /**
     * Newest first, resuming after the cursor row.
     *
     * The cursor is keyed on `(timestamp, id)` rather than on an offset, so a
     * publish arriving between two pages never repeats or skips a revision.
     */
    async listForDocument(
      documentId: DocumentId,
      page: HistoryPage,
    ): Promise<readonly RevisionIndexRow[]> {
      const belongsToDocument = eq(revisionsIndex.documentId, documentId)
      const after =
        page.cursor === undefined
          ? belongsToDocument
          : and(
              belongsToDocument,
              or(
                lt(
                  revisionsIndex.timestamp,
                  sql`(SELECT timestamp FROM revisions_index WHERE id = ${page.cursor})`,
                ),
                and(
                  eq(
                    revisionsIndex.timestamp,
                    sql`(SELECT timestamp FROM revisions_index WHERE id = ${page.cursor})`,
                  ),
                  lt(revisionsIndex.id, page.cursor),
                ),
              ),
            )

      const rows = await db
        .select()
        .from(revisionsIndex)
        .where(after)
        .orderBy(desc(revisionsIndex.timestamp), desc(revisionsIndex.id))
        .limit(page.limit)
      return rows.map(toRevisionRow)
    },

    async findForDocument(
      documentId: DocumentId,
      revision: RevisionId,
    ): Promise<RevisionIndexRow | null> {
      const rows = await db
        .select()
        .from(revisionsIndex)
        .where(
          and(eq(revisionsIndex.documentId, documentId), eq(revisionsIndex.revision, revision)),
        )
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : toRevisionRow(row)
    },

    async latestForDocument(documentId: DocumentId): Promise<RevisionIndexRow | null> {
      const rows = await db
        .select()
        .from(revisionsIndex)
        .where(eq(revisionsIndex.documentId, documentId))
        .orderBy(desc(revisionsIndex.timestamp), desc(revisionsIndex.id))
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : toRevisionRow(row)
    },
  }
}
