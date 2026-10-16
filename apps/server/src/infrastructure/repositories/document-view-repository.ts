import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'

import type { DocumentViewRepository, DocumentViewRow } from '@quill/application'
import type { DocumentId, UserId, WorkspaceId } from '@quill/domain'

import { documentViews } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'

/**
 * What a person has opened (ADR-053): their own record, never aggregated
 * across people. Every read and the per-person delete are keyed by `user_id`;
 * only the retention sweep reaches across people, and it reads nothing.
 */

function toViewRow(row: typeof documentViews.$inferSelect): DocumentViewRow {
  return {
    userId: row.userId as UserId,
    documentId: row.documentId as DocumentId,
    workspaceId: row.workspaceId as WorkspaceId,
    lastViewedAt: row.lastViewedAt,
    views: row.views,
  }
}

export function createDocumentViewRepository(db: DrizzleClient): DocumentViewRepository {
  return {
    /**
     * One statement, so two tabs opening the same document at once cannot both
     * count: the conflict branch only fires for a row older than the debounce
     * window, and a refused update returns no row, which is the answer.
     */
    async touch({ userId, documentId, workspaceId, now, debounceBefore }) {
      const written = await db
        .insert(documentViews)
        .values({ userId, documentId, workspaceId, lastViewedAt: now, views: 1 })
        .onConflictDoUpdate({
          target: [documentViews.userId, documentViews.documentId],
          set: {
            workspaceId,
            lastViewedAt: now,
            views: sql`${documentViews.views} + 1`,
          },
          setWhere: lt(documentViews.lastViewedAt, debounceBefore),
        })
        .returning({ documentId: documentViews.documentId })
      return written.length > 0
    },

    async listRecent({ userId, since, limit }) {
      const rows = await db
        .select()
        .from(documentViews)
        .where(and(eq(documentViews.userId, userId), gte(documentViews.lastViewedAt, since)))
        .orderBy(desc(documentViews.lastViewedAt), desc(documentViews.documentId))
        .limit(limit)
      return rows.map(toViewRow)
    },

    async sumByWorkspace({ userId, since }) {
      const rows = await db
        .select({
          workspaceId: documentViews.workspaceId,
          views: sql<number>`sum(${documentViews.views})::int`,
        })
        .from(documentViews)
        .where(and(eq(documentViews.userId, userId), gte(documentViews.lastViewedAt, since)))
        .groupBy(documentViews.workspaceId)
      return rows.map(({ workspaceId, views }) => ({
        workspaceId: workspaceId as WorkspaceId,
        views,
      }))
    },

    async deleteForUser(userId) {
      const gone = await db
        .delete(documentViews)
        .where(eq(documentViews.userId, userId))
        .returning({ documentId: documentViews.documentId })
      return gone.length
    },

    async deleteOlderThan(cutoff) {
      const gone = await db
        .delete(documentViews)
        .where(lt(documentViews.lastViewedAt, cutoff))
        .returning({ documentId: documentViews.documentId })
      return gone.length
    },
  }
}
