import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'

import type { NotificationKind, NotificationRepository, NotificationRow } from '@quill/application'
import type { DocumentId, UserId } from '@quill/domain'

import { notifications } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'

/**
 * A person's own notifications (ADR-053). Every read and every mark is keyed
 * by `recipient_user_id`, so one person's route cannot reach another's rows;
 * the request-wide read-marking and the retention sweep are the two that cross
 * people, and neither returns a row.
 */

function toRow(row: typeof notifications.$inferSelect): NotificationRow {
  return {
    id: row.id,
    recipientUserId: row.recipientUserId as UserId,
    kind: row.kind as NotificationKind,
    documentId: row.documentId as DocumentId,
    requestId: row.requestId,
    actorUserId: row.actorUserId as UserId | null,
    createdAt: row.createdAt,
    readAt: row.readAt,
  }
}

export function createNotificationRepository(db: DrizzleClient): NotificationRepository {
  return {
    /** The unique key on the event makes a redelivered event a no-op. */
    async insertMany(rows) {
      if (rows.length === 0) return 0
      const written = await db
        .insert(notifications)
        .values(rows.map((row) => ({ ...row })))
        .onConflictDoNothing()
        .returning({ id: notifications.id })
      return written.length
    },

    async markRequestKindRead({ requestId, kind, now }) {
      const changed = await db
        .update(notifications)
        .set({ readAt: now })
        .where(
          and(
            eq(notifications.requestId, requestId),
            eq(notifications.kind, kind),
            isNull(notifications.readAt),
          ),
        )
        .returning({ id: notifications.id })
      return changed.length
    },

    async listForUser({ userId, after, limit }) {
      const rows = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientUserId, userId),
            after === null
              ? undefined
              : or(
                  lt(notifications.createdAt, after.createdAt),
                  and(eq(notifications.createdAt, after.createdAt), lt(notifications.id, after.id)),
                ),
          ),
        )
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(limit)
      return rows.map(toRow)
    },

    async countUnread(userId) {
      const [row] = await db
        .select({ unread: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt)))
      /* v8 ignore next -- an aggregate without GROUP BY always yields exactly one row; the fallback only satisfies noUncheckedIndexedAccess. */
      return row?.unread ?? 0
    },

    async markRead({ userId, ids, now }) {
      if (ids?.length === 0) return 0
      const changed = await db
        .update(notifications)
        .set({ readAt: now })
        .where(
          and(
            eq(notifications.recipientUserId, userId),
            isNull(notifications.readAt),
            ids === undefined ? undefined : inArray(notifications.id, [...ids]),
          ),
        )
        .returning({ id: notifications.id })
      return changed.length
    },

    async deleteOlderThan(cutoff) {
      const gone = await db
        .delete(notifications)
        .where(lt(notifications.createdAt, cutoff))
        .returning({ id: notifications.id })
      return gone.length
    },
  }
}
