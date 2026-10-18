import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm'

import type {
  AppendRevisionInput,
  Contributor,
  HistoryPage,
  RevisionIndexRow,
  RevisionsIndexRepository,
} from '@quill/application'
import type { DocumentId, RevisionId, UserId, WorkspaceId } from '@quill/domain'

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
    authorUserId: row.authorUserId as UserId | null,
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
          authorUserId: input.authorUserId ?? null,
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

    /**
     * The newest revision of each document, in one query.
     *
     * `DISTINCT ON` with the same order `latestForDocument` uses, so a page of
     * a hundred public documents costs one round trip rather than a hundred
     * (AGENTS.md rule 13). An empty request is answered without asking the
     * database, because `IN ()` is not valid SQL.
     */
    async listHeads(documentIds: readonly DocumentId[]): Promise<readonly RevisionIndexRow[]> {
      if (documentIds.length === 0) return []
      const rows = await db
        .selectDistinctOn([revisionsIndex.documentId])
        .from(revisionsIndex)
        .where(inArray(revisionsIndex.documentId, [...documentIds]))
        .orderBy(revisionsIndex.documentId, desc(revisionsIndex.timestamp), desc(revisionsIndex.id))
      return rows.map(toRevisionRow)
    },

    /**
     * One row per address, under the name last published with, in one query.
     *
     * `DISTINCT ON` the folded address, newest first within each, so the name
     * that survives is the latest and the address is the one `by:` and `team:`
     * match (see the port). Ordered by address for a stable answer.
     */
    async listContributors(documentId: DocumentId): Promise<readonly Contributor[]> {
      const address = sql<string>`lower(trim(${revisionsIndex.authorEmail}))`
      const rows = await db
        .selectDistinctOn([address], { name: revisionsIndex.authorName, email: address })
        .from(revisionsIndex)
        .where(eq(revisionsIndex.documentId, documentId))
        .orderBy(address, desc(revisionsIndex.timestamp), desc(revisionsIndex.id))
      return rows.map((row) => ({ name: row.name.trim(), email: row.email }))
    },

    /**
     * Everyone who has published each of these documents, in one query.
     *
     * `DISTINCT ON` the document and the folded address, newest first within
     * each, keeps the name last used; the people are then put in order of when
     * they last published, newest first, which is how a result row names them.
     * An empty request is answered without asking the database.
     */
    async listContributorsForDocuments(
      documentIds: readonly DocumentId[],
    ): Promise<ReadonlyMap<DocumentId, readonly Contributor[]>> {
      if (documentIds.length === 0) return new Map()
      const address = sql<string>`lower(trim(${revisionsIndex.authorEmail}))`
      const rows = await db
        .selectDistinctOn([revisionsIndex.documentId, address], {
          documentId: revisionsIndex.documentId,
          name: revisionsIndex.authorName,
          email: address,
          timestamp: revisionsIndex.timestamp,
          id: revisionsIndex.id,
        })
        .from(revisionsIndex)
        .where(inArray(revisionsIndex.documentId, [...documentIds]))
        .orderBy(
          revisionsIndex.documentId,
          address,
          desc(revisionsIndex.timestamp),
          desc(revisionsIndex.id),
        )

      const newestFirst = rows.toSorted(
        (left, right) =>
          right.timestamp.getTime() - left.timestamp.getTime() || right.id.localeCompare(left.id),
      )
      const byDocument = Map.groupBy(newestFirst, (row) => row.documentId as DocumentId)
      return new Map(
        [...byDocument].map(([documentId, found]) => [
          documentId,
          found.map((row) => ({ name: row.name.trim(), email: row.email })),
        ]),
      )
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
