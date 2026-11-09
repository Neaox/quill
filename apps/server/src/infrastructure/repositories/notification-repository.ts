import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'

import { REVIEW_NOTIFICATION_KINDS } from '@quill/application'
import type {
  NewNotification,
  NotificationRepository,
  NotificationRow,
  ReviewNotificationKind,
} from '@quill/application'
import type { DocumentId, UserId, WorkspaceId } from '@quill/domain'

import { notifications } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'

/**
 * A person's own notifications (ADR-053). Every read and every mark is keyed
 * by `recipient_user_id`, so one person's route cannot reach another's rows;
 * the request-wide read-marking and the retention sweep are the two that cross
 * people, and neither returns a row.
 *
 * A workspace's row (ADR-061, a source that stopped syncing) keeps the failure
 * as a versioned document, `{ version, reason, revision }`. A row this release
 * cannot read, of a kind it does not know or with a document it cannot read,
 * is left out of the list rather than failing it (ADR-033).
 */

/** The version of a workspace row's `detail` document. */
const DETAIL_VERSION = 1

type StoredRow = typeof notifications.$inferSelect

function toRow(row: StoredRow): NotificationRow | null {
  const base = {
    id: row.id,
    recipientUserId: row.recipientUserId as UserId,
    createdAt: row.createdAt,
    readAt: row.readAt,
  }
  if (row.kind === 'source-sync-failed') {
    const failure = readFailure(row.detail)
    if (row.workspaceId === null || row.occurrence === null || failure === null) return null
    return {
      ...base,
      kind: 'source-sync-failed',
      workspaceId: row.workspaceId as WorkspaceId,
      failure,
      occurrence: row.occurrence,
    }
  }
  const kind = REVIEW_NOTIFICATION_KINDS.find((known) => known === row.kind)
  if (kind === undefined || row.documentId === null || row.requestId === null) return null
  return {
    ...base,
    kind,
    documentId: row.documentId as DocumentId,
    requestId: row.requestId,
    actorUserId: row.actorUserId as UserId | null,
  }
}

function readFailure(value: unknown): { reason: string; revision: string | null } | null {
  if (typeof value !== 'object' || value === null) return null
  const { version, reason, revision } = value as Record<string, unknown>
  if (version !== DETAIL_VERSION || typeof reason !== 'string') return null
  return { reason, revision: typeof revision === 'string' ? revision : null }
}

function toStored(row: NewNotification): typeof notifications.$inferInsert {
  const base = {
    id: row.id,
    recipientUserId: row.recipientUserId,
    kind: row.kind,
    createdAt: row.createdAt,
  }
  if (row.kind === 'source-sync-failed') {
    return {
      ...base,
      workspaceId: row.workspaceId,
      occurrence: row.occurrence,
      detail: { version: DETAIL_VERSION, ...row.failure },
    }
  }
  return {
    ...base,
    documentId: row.documentId,
    requestId: row.requestId,
    actorUserId: row.actorUserId,
  }
}

const isRow = (row: NotificationRow | null): row is NotificationRow => row !== null

export function createNotificationRepository(db: DrizzleClient): NotificationRepository {
  return {
    /** The unique key on the event makes a redelivered event a no-op. */
    async insertMany(rows) {
      if (rows.length === 0) return 0
      const written = await db
        .insert(notifications)
        .values(rows.map(toStored))
        .onConflictDoNothing()
        .returning({ id: notifications.id })
      return written.length
    },

    async markRequestKindRead({
      requestId,
      kind,
      now,
    }: {
      readonly requestId: string
      readonly kind: ReviewNotificationKind
      readonly now: Date
    }) {
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
      return rows.map(toRow).filter(isRow)
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
