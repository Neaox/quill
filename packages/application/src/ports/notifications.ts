import type { DocumentId, UserId } from '@quill/domain'

/**
 * In-app notifications as they are stored (ADR-053, "Notifications").
 *
 * A notification is one person's own row about something that happened to a
 * document they were asked to look at, or asked someone to look at. It is read
 * only by its recipient, through their own routes, and kept 90 days.
 */

export const NOTIFICATION_KINDS = [
  'review-requested',
  'changes-requested',
  'review-approved',
  'review-withdrawn',
] as const

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export interface NotificationRow {
  readonly id: string
  readonly recipientUserId: UserId
  readonly kind: NotificationKind
  readonly documentId: DocumentId
  readonly requestId: string
  /** Who did it; null once that person has gone. */
  readonly actorUserId: UserId | null
  readonly createdAt: Date
  readonly readAt: Date | null
}

export type NewNotification = Omit<NotificationRow, 'readAt'>

/** Where a page of the list resumes: strictly after this row in newest-first order. */
export interface NotificationCursor {
  readonly createdAt: Date
  readonly id: string
}

export interface NotificationRepository {
  /**
   * Writes the rows, skipping any whose `(request, recipient, kind, actor)`
   * already exists, so an outbox event delivered twice writes once. Answers
   * how many rows were new.
   */
  insertMany(rows: readonly NewNotification[]): Promise<number>
  /** Marks a request's unread rows of one kind read, for every recipient. Answers how many changed. */
  markRequestKindRead(input: {
    readonly requestId: string
    readonly kind: NotificationKind
    readonly now: Date
  }): Promise<number>
  /** The person's rows, newest first (by time, then id), strictly after `after`. */
  listForUser(input: {
    readonly userId: UserId
    readonly after: NotificationCursor | null
    readonly limit: number
  }): Promise<readonly NotificationRow[]>
  countUnread(userId: UserId): Promise<number>
  /** Marks the person's own unread rows read: those named, or every one when `ids` is omitted. */
  markRead(input: {
    readonly userId: UserId
    readonly ids: readonly string[] | undefined
    readonly now: Date
  }): Promise<number>
  /** Removes every row created before `cutoff`, for every person. Answers how many went. */
  deleteOlderThan(cutoff: Date): Promise<number>
}
