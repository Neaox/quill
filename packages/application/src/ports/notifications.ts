import type { DocumentId, UserId, WorkspaceId } from '@quill/domain'

/**
 * In-app notifications as they are stored (ADR-053, "Notifications").
 *
 * A notification is one person's own row. Most are about a document they
 * were asked to look at, or asked someone to look at (ADR-052). One kind is
 * about a workspace instead: its source stopped syncing, told to the
 * workspace's administrators once per distinct failure (ADR-061). Rows are
 * read only by their recipient, through their own routes, and kept 90 days.
 */

export const REVIEW_NOTIFICATION_KINDS = [
  'review-requested',
  'changes-requested',
  'review-approved',
  'review-withdrawn',
] as const

export const NOTIFICATION_KINDS = [...REVIEW_NOTIFICATION_KINDS, 'source-sync-failed'] as const

export type ReviewNotificationKind = (typeof REVIEW_NOTIFICATION_KINDS)[number]
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

interface NotificationBase {
  readonly id: string
  readonly recipientUserId: UserId
  readonly createdAt: Date
  readonly readAt: Date | null
}

/** Something happened to a review request about a document. */
export interface ReviewNotificationRow extends NotificationBase {
  readonly kind: ReviewNotificationKind
  readonly documentId: DocumentId
  readonly requestId: string
  /** Who did it; null once that person has gone. */
  readonly actorUserId: UserId | null
}

/**
 * A sourced workspace's sync stopped (ADR-061). The reason and the source
 * revision are kept as they were when it was told, so the row still reads
 * after the source has recovered; the admin page has the rest.
 */
export interface SourceSyncFailedNotificationRow extends NotificationBase {
  readonly kind: 'source-sync-failed'
  readonly workspaceId: WorkspaceId
  readonly failure: { readonly reason: string; readonly revision: string | null }
  /**
   * Which failure this was, so one failure is told once however often the
   * outbox delivers it, and a failure that comes back after a good sync is
   * told again.
   */
  readonly occurrence: string
}

export type NotificationRow = ReviewNotificationRow | SourceSyncFailedNotificationRow

export type NewNotification =
  | Omit<ReviewNotificationRow, 'readAt'>
  | Omit<SourceSyncFailedNotificationRow, 'readAt'>

/** Where a page of the list resumes: strictly after this row in newest-first order. */
export interface NotificationCursor {
  readonly createdAt: Date
  readonly id: string
}

export interface NotificationRepository {
  /**
   * Writes the rows, skipping any whose `(request, recipient, kind, actor)`,
   * or for a workspace's row `(recipient, kind, occurrence)`, already exists,
   * so an outbox event delivered twice writes once. Answers how many rows
   * were new.
   */
  insertMany(rows: readonly NewNotification[]): Promise<number>
  /** Marks a request's unread rows of one kind read, for every recipient. Answers how many changed. */
  markRequestKindRead(input: {
    readonly requestId: string
    readonly kind: ReviewNotificationKind
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
