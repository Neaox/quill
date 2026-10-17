import type { DocumentId, ReviewerKind, UserId } from '@quill/domain'

import type {
  NewNotification,
  NotificationCursor,
  NotificationKind,
  NotificationRow,
} from '../ports/notifications.ts'
import type { GroupId, RepositoryBundle, UnitOfWork } from '../ports/persistence.ts'
import type { Clock, IdGenerator } from '../ports/system.ts'
import type { Authorizer } from './authorizer.ts'
import type {
  ReviewDecidedPayload,
  ReviewRequestedPayload,
  ReviewWithdrawnPayload,
} from './events.ts'

/**
 * In-app notifications (ADR-053, "Notifications"; the events are ADR-052's).
 *
 * Two halves. The `notify…` functions are what the outbox consumers run when a
 * review event arrives: they decide who hears about it and write one row each.
 * Every write is idempotent per event because delivery is at-least-once: a row
 * is unique per request, recipient, kind and actor, so a redelivered event
 * finds its rows already there and writes nothing. The rest is what the
 * recipient does with their own rows: page through them, count the unread,
 * mark them read.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** How long a notification is kept (ADR-053). */
export const NOTIFICATION_RETENTION_MS = 90 * DAY_MS

export const NOTIFICATION_PAGE_DEFAULT = 20
export const NOTIFICATION_PAGE_MAX = 50
/** Unreadable documents are skipped, so a page may need more than one read; this bounds the reading. */
const MAX_SCAN_ROUNDS = 4

const FORMER_MEMBER = 'Former member'

export interface NotificationDependencies {
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly ids: IdGenerator
}

interface Reviewer {
  readonly kind: ReviewerKind
  readonly id: string
}

/**
 * The people behind a list of reviewers: each person named, and each member of
 * each group named, the groups nested inside them included (the same reach a
 * grant to a group has, ADR-012). A person named twice is one person.
 */
async function peopleBehind(
  repos: RepositoryBundle,
  reviewers: readonly Reviewer[],
): Promise<Set<UserId>> {
  const named = reviewers.filter((reviewer) => reviewer.kind === 'user')
  const groups = reviewers.filter((reviewer) => reviewer.kind === 'group')
  const members = await repos.reviews.listMemberIdsDeep(groups.map((group) => group.id as GroupId))
  return new Set([...named.map((reviewer) => reviewer.id as UserId), ...members])
}

interface Announcement {
  readonly kind: NotificationKind
  readonly requestId: string
  readonly documentId: DocumentId
  readonly actor: UserId
  readonly recipients: Iterable<UserId>
}

/** One row per recipient who still exists; a notification to somebody who has gone has nowhere to live. */
async function announce(
  deps: NotificationDependencies,
  repos: RepositoryBundle,
  announcement: Announcement,
): Promise<number> {
  const recipients = [...announcement.recipients]
  const existing = new Set(
    (await repos.users.listByIds([announcement.actor, ...recipients])).map((user) => user.id),
  )
  const actorUserId = existing.has(announcement.actor) ? announcement.actor : null
  const createdAt = deps.clock.now()
  const rows = recipients
    .filter((recipient) => existing.has(recipient))
    .map((recipientUserId): NewNotification => ({
      id: deps.ids.uuid(),
      recipientUserId,
      kind: announcement.kind,
      documentId: announcement.documentId,
      requestId: announcement.requestId,
      actorUserId,
      createdAt,
    }))
  return repos.notifications.insertMany(rows)
}

/**
 * Tells each person asked, and each member of each group asked, but never the
 * one asking.
 *
 * Events of different types are consumed independently, so this can run after
 * the request was already withdrawn, published or replaced. The rows are then
 * written already read, which is where the withdrawal's own consumer would have
 * left them: the end state does not depend on which got there first.
 */
export function notifyReviewRequested(
  deps: NotificationDependencies,
  event: ReviewRequestedPayload,
): Promise<number> {
  return deps.uow.run(async (repos) => {
    const request = await repos.reviews.findById(event.requestId)
    if (request === null) return 0
    const people = await peopleBehind(repos, event.reviewers)
    people.delete(event.requestedBy)
    const written = await announce(deps, repos, {
      kind: 'review-requested',
      requestId: event.requestId,
      documentId: event.documentId,
      actor: event.requestedBy,
      recipients: people,
    })
    if (request.closedAt !== null) {
      await repos.notifications.markRequestKindRead({
        requestId: event.requestId,
        kind: 'review-requested',
        now: deps.clock.now(),
      })
    }
    return written
  })
}

/** Tells the person who asked, once the answers settle the request one way or the other. */
export function notifyReviewDecided(
  deps: NotificationDependencies,
  event: ReviewDecidedPayload,
): Promise<number> {
  const kind = settledKind(event.status)
  if (kind === null) return Promise.resolve(0)
  return deps.uow.run(async (repos) => {
    const request = await repos.reviews.findById(event.requestId)
    if (request === null || request.requestedBy === event.decidedBy) return 0
    return announce(deps, repos, {
      kind,
      requestId: event.requestId,
      documentId: event.documentId,
      actor: event.decidedBy,
      recipients: [request.requestedBy],
    })
  })
}

function settledKind(status: ReviewDecidedPayload['status']): NotificationKind | null {
  if (status === 'approved') return 'review-approved'
  if (status === 'changes_requested') return 'changes-requested'
  return null
}

/**
 * The request was taken back or replaced. What it asked of people is no longer
 * pending, so their unread "asked to review" rows are read; a plain withdrawal
 * also says so, while a supersession is followed by the new request's own
 * notification and needs no second one.
 */
export function notifyReviewWithdrawn(
  deps: NotificationDependencies,
  event: ReviewWithdrawnPayload,
): Promise<number> {
  return deps.uow.run(async (repos) => {
    await repos.notifications.markRequestKindRead({
      requestId: event.requestId,
      kind: 'review-requested',
      now: deps.clock.now(),
    })
    if (event.reason === 'superseded') return 0
    const assignments = await repos.reviews.listAssignments([event.requestId])
    const people = await peopleBehind(
      repos,
      assignments.map((assignment) => ({
        kind: assignment.principalKind,
        id: assignment.principalId,
      })),
    )
    people.delete(event.withdrawnBy)
    return announce(deps, repos, {
      kind: 'review-withdrawn',
      requestId: event.requestId,
      documentId: event.documentId,
      actor: event.withdrawnBy,
      recipients: people,
    })
  })
}

// ---------------------------------------------------------------------------
// Reading and marking
// ---------------------------------------------------------------------------

export interface NotificationItem {
  readonly id: string
  readonly kind: NotificationKind
  readonly document: {
    readonly id: DocumentId
    readonly shortId: string
    readonly title: string
    readonly workspaceId: string
  }
  readonly actor: { readonly id: string; readonly name: string }
  readonly at: Date
  readonly readAt: Date | null
}

export interface ListNotificationsCommand {
  readonly userId: UserId
  readonly authorizer: Authorizer
  readonly limit?: number | undefined
  /** The opaque `next` of the page before. */
  readonly before?: string | undefined
}

export type ListNotificationsResult =
  | {
      readonly kind: 'listed'
      readonly items: readonly NotificationItem[]
      /**
       * Every unread row of the person's, counted without asking whether each
       * document can still be viewed: one indexed count rather than one
       * authorisation per document on every poll.
       */
      readonly unread: number
      readonly next?: string
    }
  | { readonly kind: 'bad-cursor' }

const cursorOf = (row: NotificationRow): NotificationCursor => ({
  createdAt: row.createdAt,
  id: row.id,
})

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`).toString('base64url')
}

export function decodeNotificationCursor(value: string): NotificationCursor | null {
  const [at, id, ...rest] = Buffer.from(value, 'base64url').toString().split('|')
  if (at === undefined || id === undefined || id === '' || rest.length > 0) return null
  const createdAt = new Date(at)
  return Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== at
    ? null
    : { createdAt, id }
}

interface Visible {
  readonly row: NotificationRow
  readonly document: NotificationItem['document']
}

/**
 * The person's notifications, newest first, leaving out those about documents
 * they can no longer view. The documents are asked about together (the
 * authorizer memoises each), the actors' names come from one read, and a page
 * that loses rows to the filter is topped up from the rows after it.
 */
export async function listNotifications(
  deps: Pick<NotificationDependencies, 'uow'>,
  command: ListNotificationsCommand,
): Promise<ListNotificationsResult> {
  const { repos } = deps.uow
  const limit = Math.min(
    Math.max(command.limit ?? NOTIFICATION_PAGE_DEFAULT, 1),
    NOTIFICATION_PAGE_MAX,
  )
  let cursor: NotificationCursor | null = null
  if (command.before !== undefined) {
    cursor = decodeNotificationCursor(command.before)
    if (cursor === null) return { kind: 'bad-cursor' }
  }

  const kept: Visible[] = []
  let more = false
  for (let round = 0; round < MAX_SCAN_ROUNDS && kept.length < limit; round += 1) {
    // One row more than a page tells whether anything lies beyond it.
    const rows = await repos.notifications.listForUser({
      userId: command.userId,
      after: cursor,
      limit: limit + 1,
    })
    const verdicts = await Promise.all(
      rows.map((row) => command.authorizer.document(row.documentId)),
    )
    more = rows.length > limit
    for (const [index, row] of rows.entries()) {
      if (kept.length === limit) {
        more = true
        break
      }
      const access = verdicts[index]
      if (access?.ok === true && access.value.capabilities.view) {
        const { id, shortId, title, workspaceId } = access.value.document
        kept.push({ row, document: { id, shortId, title, workspaceId } })
      }
      cursor = cursorOf(row)
    }
    if (!more) break
  }

  const actorIds = [
    ...new Set(kept.flatMap(({ row }) => (row.actorUserId === null ? [] : [row.actorUserId]))),
  ]
  const names = new Map(
    (await repos.users.listByIds(actorIds)).map((user) => [user.id, user.displayName]),
  )
  const items = kept.map(({ row, document }): NotificationItem => ({
    id: row.id,
    kind: row.kind,
    document,
    actor: {
      id: row.actorUserId ?? '',
      name: (row.actorUserId === null ? undefined : names.get(row.actorUserId)) ?? FORMER_MEMBER,
    },
    at: row.createdAt,
    readAt: row.readAt,
  }))
  const unread = await repos.notifications.countUnread(command.userId)
  return {
    kind: 'listed',
    items,
    unread,
    ...(more && cursor !== null ? { next: encodeNotificationCursor(cursor) } : {}),
  }
}

export interface MarkNotificationsReadCommand {
  readonly userId: UserId
  /** Omitted, every unread notification of the person's. */
  readonly ids?: readonly string[] | undefined
}

/** Marks the person's own notifications read; ids that are not theirs match nothing. */
export function markNotificationsRead(
  deps: Pick<NotificationDependencies, 'uow' | 'clock'>,
  command: MarkNotificationsReadCommand,
): Promise<number> {
  return deps.uow.repos.notifications.markRead({
    userId: command.userId,
    ids: command.ids,
    now: deps.clock.now(),
  })
}

/** Removes every notification older than the retention window, for the housekeeping job. */
export function sweepNotifications(
  deps: Pick<NotificationDependencies, 'uow'>,
  now: Date,
): Promise<number> {
  return deps.uow.repos.notifications.deleteOlderThan(
    new Date(now.getTime() - NOTIFICATION_RETENTION_MS),
  )
}
