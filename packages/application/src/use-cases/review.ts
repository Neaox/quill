import { assignmentStateFor, deriveReviewStatus, isActiveReviewStatus } from '@quill/domain'
import type {
  AssignmentState,
  DocumentId,
  ReviewDecision,
  ReviewerKind,
  ReviewStatus,
  UserId,
  WorkspaceId,
} from '@quill/domain'

import type { DocumentRow, GroupId, RepositoryBundle, UnitOfWork } from '../ports/persistence.ts'
import type {
  GroupMatch,
  PersonMatch,
  ReviewAssignmentRow,
  ReviewRequestRow,
} from '../ports/reviews.ts'
import type { Clock, IdGenerator } from '../ports/system.ts'
import type { Authorizer } from './authorizer.ts'
import {
  EVENT_PAYLOAD_VERSION,
  REVIEW_DECIDED,
  REVIEW_REQUESTED,
  REVIEW_WITHDRAWN,
} from './events.ts'
import type {
  ReviewDecidedPayload,
  ReviewRequestedPayload,
  ReviewWithdrawnPayload,
} from './events.ts'
import { createReviewerAccessProbe } from './review-access.ts'
import type { ReviewerRef } from './review-access.ts'

/**
 * Review requests (ADR-052): ask named people and groups to look at a draft.
 *
 * - One request is active per document; asking again supersedes the earlier one.
 * - Everyone tagged can already view the document, checked through the same
 *   resolver a request is, for a person (their groups included) and for a group.
 * - A group is answered by any member. One answer applies to every assignment
 *   naming the person, directly or through a group they are in.
 * - `stale` is read, not stored: the draft's version differs from the one the
 *   request was made against, so an edit needs no extra write.
 * - A publish closes the active request in the transaction that records it.
 *
 * Every change, its outbox event and its audit row are one transaction. Audit
 * rows and events name ids and never a message or a comment.
 */

export const REVIEW_AUDIT_EVENTS = {
  requested: 'review.requested',
  decided: 'review.decided',
  withdrawn: 'review.withdrawn',
  superseded: 'review.superseded',
  published: 'review.published',
} as const

export const MAX_REVIEWERS = 20
export const MAX_REVIEW_TEXT = 1000
/** How many people and groups the candidate search looks at before it narrows to those who can view. */
const CANDIDATE_SCAN = 100
export const CANDIDATE_LIMIT = 20
export const ATTENTION_LIMIT = 20

export interface ReviewDependencies {
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface PersonRef {
  readonly id: string
  readonly name: string
}

export interface ReviewAssignmentView {
  readonly id: string
  readonly reviewer: {
    readonly kind: ReviewerKind
    readonly id: string
    readonly name: string
    readonly memberCount?: number
  }
  readonly state: AssignmentState
  readonly decidedBy: PersonRef | null
  readonly comment: string | null
  readonly decidedAt: Date | null
}

export interface ReviewRequestView {
  readonly id: string
  readonly documentId: DocumentId
  readonly status: ReviewStatus
  readonly requestedBy: PersonRef
  readonly message: string | null
  readonly createdAt: Date
  readonly draftVersion: number
  readonly stale: boolean
  readonly assignments: readonly ReviewAssignmentView[]
  /** The request is active and the caller is tagged on it, directly or through a group. */
  readonly canDecide: boolean
  /** The request is active and the caller made it or may manage the document. */
  readonly canWithdraw: boolean
}

/** Who is looking, for the two caller-specific answers in a view. */
interface Viewer {
  readonly userId: UserId
  readonly canManage: boolean
}

const FORMER_MEMBER = 'Former member'

function clean(text: string | undefined | null): string | null {
  const value = text?.trim() ?? ''
  return value === '' ? null : value.slice(0, MAX_REVIEW_TEXT)
}

async function heldGroupIds(repos: RepositoryBundle, userId: UserId): Promise<ReadonlySet<string>> {
  return new Set((await repos.groups.listForUser(userId)).map((group) => group.id))
}

/** The assignments that name this person, directly or through a group they hold. */
function namingPerson(
  assignments: readonly ReviewAssignmentRow[],
  userId: UserId,
  groupIds: ReadonlySet<string>,
): readonly ReviewAssignmentRow[] {
  return assignments.filter((assignment) =>
    assignment.principalKind === 'user'
      ? assignment.principalId === userId
      : groupIds.has(assignment.principalId),
  )
}

async function buildViews(
  repos: RepositoryBundle,
  rows: readonly ReviewRequestRow[],
  viewer: Viewer,
): Promise<readonly ReviewRequestView[]> {
  const assignments = await repos.reviews.listAssignments(rows.map((row) => row.id))
  const groupIds = await heldGroupIds(repos, viewer.userId)

  const userIds = new Set<UserId>()
  const reviewerGroupIds = new Set<GroupId>()
  for (const row of rows) userIds.add(row.requestedBy)
  for (const assignment of assignments) {
    if (assignment.decidedBy !== null) userIds.add(assignment.decidedBy)
    if (assignment.principalKind === 'user') userIds.add(assignment.principalId as UserId)
    else reviewerGroupIds.add(assignment.principalId)
  }
  const [people, groupRows, counts, drafts] = await Promise.all([
    repos.users.listByIds([...userIds]),
    Promise.all([...reviewerGroupIds].map((id) => repos.groups.findById(id))),
    repos.reviews.countGroupMembers([...reviewerGroupIds]),
    Promise.all(rows.map((row) => repos.drafts.find(row.documentId))),
  ])
  const names = new Map<string, string>(people.map((person) => [person.id, person.displayName]))
  const groupNames = new Map<string, string>(
    groupRows.flatMap((group): [string, string][] =>
      group === null ? [] : [[group.id, group.name]],
    ),
  )
  const person = (id: string): PersonRef => ({ id, name: names.get(id) ?? FORMER_MEMBER })

  return rows.map((row, index) => {
    const own = assignments.filter((assignment) => assignment.requestId === row.id)
    const active = isActiveReviewStatus(row.status)
    const currentVersion = drafts[index]?.draftVersion ?? 0
    return {
      id: row.id,
      documentId: row.documentId,
      status: row.status,
      requestedBy: person(row.requestedBy),
      message: row.message,
      createdAt: row.createdAt,
      draftVersion: row.draftVersion,
      stale: active && currentVersion !== row.draftVersion,
      assignments: own.map((assignment) => ({
        id: assignment.id,
        reviewer:
          assignment.principalKind === 'user'
            ? { kind: 'user', ...person(assignment.principalId) }
            : {
                kind: 'group',
                id: assignment.principalId,
                name: groupNames.get(assignment.principalId) ?? FORMER_MEMBER,
                memberCount: counts.get(assignment.principalId) ?? 0,
              },
        state: assignment.state,
        decidedBy: assignment.decidedBy === null ? null : person(assignment.decidedBy),
        comment: assignment.comment,
        decidedAt: assignment.decidedAt,
      })),
      canDecide: active && namingPerson(own, viewer.userId, groupIds).length > 0,
      canWithdraw: active && (row.requestedBy === viewer.userId || viewer.canManage),
    }
  })
}

async function buildView(
  repos: RepositoryBundle,
  row: ReviewRequestRow,
  viewer: Viewer,
): Promise<ReviewRequestView> {
  const [view] = await buildViews(repos, [row], viewer)
  /* v8 ignore next -- one row in, one view out. */
  if (view === undefined) throw new Error('a review request produced no view')
  return view
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface GetReviewCommand {
  readonly documentId: DocumentId
  readonly userId: UserId
  readonly canEdit: boolean
  readonly canManage: boolean
}

/**
 * The document's active request, or the latest closed one.
 *
 * Somebody who may neither edit nor was ever tagged gets nothing, the same
 * answer as a document with no request, so the question reveals nothing.
 */
export async function getReview(
  deps: Pick<ReviewDependencies, 'uow'>,
  command: GetReviewCommand,
): Promise<ReviewRequestView | null> {
  const { repos } = deps.uow
  const row = await repos.reviews.findLatestForDocument(command.documentId)
  if (row === null) return null
  if (!command.canEdit) {
    const assignments = await repos.reviews.listAssignments([row.id])
    const groupIds = await heldGroupIds(repos, command.userId)
    const named = namingPerson(assignments, command.userId, groupIds).length > 0
    if (!named && row.requestedBy !== command.userId) return null
  }
  return buildView(repos, row, { userId: command.userId, canManage: command.canManage })
}

/**
 * Whether this person is tagged on the document's *active* request, directly
 * or through a group. It is what lets a reviewer without `edit` read the draft
 * they were asked about, and only that.
 */
export async function isAssignedReviewer(
  deps: Pick<ReviewDependencies, 'uow'>,
  documentId: DocumentId,
  userId: UserId,
): Promise<boolean> {
  const { repos } = deps.uow
  const active = await repos.reviews.findActiveForDocument(documentId)
  if (active === null) return false
  const assignments = await repos.reviews.listAssignments([active.id])
  return namingPerson(assignments, userId, await heldGroupIds(repos, userId)).length > 0
}

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

export interface RequestReviewCommand {
  readonly documentId: DocumentId
  readonly requestedBy: UserId
  readonly canManage: boolean
  readonly reviewers: readonly ReviewerRef[]
  readonly message?: string | undefined
}

export type RequestReviewResult =
  | { readonly kind: 'requested'; readonly review: ReviewRequestView }
  | { readonly kind: 'invalid-reviewers'; readonly count: number }
  | { readonly kind: 'reviewers-cannot-view'; readonly reviewers: readonly ReviewerRef[] }
  | { readonly kind: 'not-found' }

export async function requestReview(
  deps: ReviewDependencies,
  command: RequestReviewCommand,
): Promise<RequestReviewResult> {
  const reviewers = [
    ...new Map(command.reviewers.map((r) => [`${r.kind}:${r.id}`, r] as const)).values(),
  ]
  if (reviewers.length < 1 || reviewers.length > MAX_REVIEWERS) {
    return { kind: 'invalid-reviewers', count: reviewers.length }
  }

  const document = await deps.uow.repos.documents.findById(command.documentId)
  if (document === null) return { kind: 'not-found' }
  const probe = await createReviewerAccessProbe(deps.uow.repos, command.documentId)
  if (probe === null) return { kind: 'not-found' }
  const verdicts = await Promise.all(
    reviewers.map(async (r) => [r, await probe.canView(r)] as const),
  )
  const refused = verdicts.filter(([, canView]) => !canView).map(([r]) => r)
  if (refused.length > 0) return { kind: 'reviewers-cannot-view', reviewers: refused }

  const now = deps.clock.now()
  const requestId = deps.ids.uuid()
  const row = await deps.uow.run(async (tx) => {
    const earlier = await tx.reviews.findActiveForDocument(command.documentId)
    if (earlier !== null) {
      await tx.reviews.setStatus(earlier.id, 'superseded', now)
      await recordWithdrawal(deps, tx, {
        request: earlier,
        workspaceId: document.workspaceId,
        by: command.requestedBy,
        reason: 'superseded',
        now,
      })
    }

    const draft = await tx.drafts.find(command.documentId)
    const created = await tx.reviews.create({
      id: requestId,
      documentId: command.documentId,
      requestedBy: command.requestedBy,
      draftVersion: draft?.draftVersion ?? 0,
      message: clean(command.message),
      reviewers: reviewers.map((r) => ({ id: deps.ids.uuid(), kind: r.kind, principalId: r.id })),
      now,
    })

    const payload: ReviewRequestedPayload = {
      version: EVENT_PAYLOAD_VERSION,
      requestId,
      documentId: command.documentId,
      workspaceId: document.workspaceId,
      requestedBy: command.requestedBy,
      reviewers: reviewers.map((r) => ({ kind: r.kind, id: r.id })),
    }
    await tx.outbox.write({ id: deps.ids.uuid(), type: REVIEW_REQUESTED, payload, now })
    await tx.audit.write({
      id: deps.ids.uuid(),
      type: REVIEW_AUDIT_EVENTS.requested,
      actorUserId: command.requestedBy,
      targetType: 'review-request',
      targetId: requestId,
      metadata: {
        documentId: command.documentId,
        reviewers: payload.reviewers,
        supersedes: earlier?.id ?? null,
      },
      now,
    })
    return created
  })

  return {
    kind: 'requested',
    review: await buildView(deps.uow.repos, row, {
      userId: command.requestedBy,
      canManage: command.canManage,
    }),
  }
}

/** The event and audit row for a request that stopped being asked, in the caller's transaction. */
async function recordWithdrawal(
  deps: ReviewDependencies,
  tx: RepositoryBundle,
  input: {
    readonly request: ReviewRequestRow
    readonly workspaceId: WorkspaceId
    readonly by: UserId
    readonly reason: 'withdrawn' | 'superseded'
    readonly now: Date
  },
): Promise<void> {
  const payload: ReviewWithdrawnPayload = {
    version: EVENT_PAYLOAD_VERSION,
    requestId: input.request.id,
    documentId: input.request.documentId,
    workspaceId: input.workspaceId,
    withdrawnBy: input.by,
    reason: input.reason,
  }
  await tx.outbox.write({ id: deps.ids.uuid(), type: REVIEW_WITHDRAWN, payload, now: input.now })
  await tx.audit.write({
    id: deps.ids.uuid(),
    type:
      input.reason === 'superseded'
        ? REVIEW_AUDIT_EVENTS.superseded
        : REVIEW_AUDIT_EVENTS.withdrawn,
    actorUserId: input.by,
    targetType: 'review-request',
    targetId: input.request.id,
    metadata: { documentId: input.request.documentId },
    now: input.now,
  })
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

export interface DecideReviewCommand {
  readonly documentId: DocumentId
  readonly userId: UserId
  readonly canManage: boolean
  readonly decision: ReviewDecision
  readonly comment?: string | undefined
}

export type DecideReviewResult =
  | { readonly kind: 'decided'; readonly review: ReviewRequestView }
  | { readonly kind: 'no-open-request' }
  | { readonly kind: 'not-assigned' }

export async function decideReview(
  deps: ReviewDependencies,
  command: DecideReviewCommand,
): Promise<DecideReviewResult> {
  const { repos } = deps.uow
  const request = await repos.reviews.findActiveForDocument(command.documentId)
  if (request === null) return { kind: 'no-open-request' }
  const assignments = await repos.reviews.listAssignments([request.id])
  const mine = namingPerson(assignments, command.userId, await heldGroupIds(repos, command.userId))
  if (mine.length === 0) return { kind: 'not-assigned' }
  const document = await repos.documents.findById(command.documentId)
  /* v8 ignore next -- a request cannot outlive its document. */
  if (document === null) return { kind: 'no-open-request' }

  const now = deps.clock.now()
  const state = assignmentStateFor(command.decision)
  const row = await deps.uow.run(async (tx) => {
    await tx.reviews.recordDecision({
      assignmentIds: mine.map((assignment) => assignment.id),
      state,
      decidedBy: command.userId,
      comment: clean(command.comment),
      now,
    })
    const answered = new Set(mine.map((assignment) => assignment.id))
    const status = deriveReviewStatus(
      assignments.map((assignment) => (answered.has(assignment.id) ? state : assignment.state)),
    )
    const updated = await tx.reviews.setStatus(request.id, status, now)
    const payload: ReviewDecidedPayload = {
      version: EVENT_PAYLOAD_VERSION,
      requestId: request.id,
      documentId: command.documentId,
      workspaceId: document.workspaceId,
      decidedBy: command.userId,
      decision: command.decision,
      status,
    }
    await tx.outbox.write({ id: deps.ids.uuid(), type: REVIEW_DECIDED, payload, now })
    await tx.audit.write({
      id: deps.ids.uuid(),
      type: REVIEW_AUDIT_EVENTS.decided,
      actorUserId: command.userId,
      targetType: 'review-request',
      targetId: request.id,
      metadata: { documentId: command.documentId, decision: command.decision, status },
      now,
    })
    /* v8 ignore next -- the request was read in this transaction, so it is still there to update. */
    return updated ?? request
  })

  return {
    kind: 'decided',
    review: await buildView(repos, row, { userId: command.userId, canManage: command.canManage }),
  }
}

// ---------------------------------------------------------------------------
// Withdrawing, and publishing
// ---------------------------------------------------------------------------

export interface WithdrawReviewCommand {
  readonly documentId: DocumentId
  readonly userId: UserId
  readonly canManage: boolean
}

export type WithdrawReviewResult =
  | { readonly kind: 'withdrawn' }
  | { readonly kind: 'no-open-request' }
  | { readonly kind: 'forbidden' }

export async function withdrawReview(
  deps: ReviewDependencies,
  command: WithdrawReviewCommand,
): Promise<WithdrawReviewResult> {
  const { repos } = deps.uow
  const request = await repos.reviews.findActiveForDocument(command.documentId)
  if (request === null) return { kind: 'no-open-request' }
  if (request.requestedBy !== command.userId && !command.canManage) return { kind: 'forbidden' }
  const document = await repos.documents.findById(command.documentId)
  /* v8 ignore next -- a request cannot outlive its document. */
  if (document === null) return { kind: 'no-open-request' }

  const now = deps.clock.now()
  await deps.uow.run(async (tx) => {
    await tx.reviews.setStatus(request.id, 'withdrawn', now)
    await recordWithdrawal(deps, tx, {
      request,
      workspaceId: document.workspaceId,
      by: command.userId,
      reason: 'withdrawn',
      now,
    })
  })
  return { kind: 'withdrawn' }
}

/**
 * A publish ends the review of what was published. Called inside the publish
 * transaction (`recordPublish`), so the request can never stay active against
 * a document that has gone live. Nothing to do when there is none, which is
 * also what makes a repeated recording harmless.
 */
export async function closeReviewOnPublish(
  tx: RepositoryBundle,
  input: {
    readonly documentId: DocumentId
    readonly publishedBy: UserId
    readonly now: Date
    readonly ids: IdGenerator
  },
): Promise<void> {
  const active = await tx.reviews.findActiveForDocument(input.documentId)
  if (active === null) return
  await tx.reviews.setStatus(active.id, 'published', input.now)
  await tx.audit.write({
    id: input.ids.uuid(),
    type: REVIEW_AUDIT_EVENTS.published,
    actorUserId: input.publishedBy,
    targetType: 'review-request',
    targetId: active.id,
    metadata: { documentId: input.documentId },
    now: input.now,
  })
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export interface ListReviewerCandidatesCommand {
  readonly documentId: DocumentId
  readonly query: string
  readonly canManage: boolean
}

export interface ReviewerCandidates {
  readonly people: readonly {
    readonly id: string
    readonly name: string
    readonly email: string
    readonly canView: boolean
  }[]
  readonly groups: readonly {
    readonly id: string
    readonly name: string
    readonly memberCount: number
    readonly canView: boolean
  }[]
}

/**
 * Who could be tagged, matched by name.
 *
 * The search scans a bounded number of matches and keeps those who can view
 * the document; somebody who cannot is listed only for a caller who may manage
 * the document, because that is the person who could grant them access.
 * Everyone else sees only people already able to open the document, so the
 * list never reveals anybody the caller could not already see by other means.
 */
export async function listReviewerCandidates(
  deps: Pick<ReviewDependencies, 'uow'>,
  command: ListReviewerCandidatesCommand,
): Promise<ReviewerCandidates> {
  const { repos } = deps.uow
  const probe = await createReviewerAccessProbe(repos, command.documentId)
  if (probe === null) return { people: [], groups: [] }
  const query = command.query.trim()

  const [people, groups] = await Promise.all([
    repos.reviews.searchPeople(query, CANDIDATE_SCAN),
    repos.reviews.searchGroups(query, CANDIDATE_SCAN),
  ])
  const [peopleVerdicts, groupVerdicts] = await Promise.all([
    Promise.all(
      people.map(
        async (person) => [person, await probe.canView({ kind: 'user', id: person.id })] as const,
      ),
    ),
    Promise.all(
      groups.map(
        async (group) => [group, await probe.canView({ kind: 'group', id: group.id })] as const,
      ),
    ),
  ])

  const shown = <T>(verdicts: readonly (readonly [T, boolean])[]): (readonly [T, boolean])[] =>
    verdicts
      .filter(([, canView]) => canView || command.canManage)
      // Those who can already view come first, in name order within each half.
      .toSorted(([, left], [, right]) => Number(right) - Number(left))
      .slice(0, CANDIDATE_LIMIT)

  const shownGroups = shown<GroupMatch>(groupVerdicts)
  const counts = await repos.reviews.countGroupMembers(shownGroups.map(([group]) => group.id))
  return {
    people: shown<PersonMatch>(peopleVerdicts).map(([person, canView]) => ({
      id: person.id,
      name: person.displayName,
      email: person.email,
      canView,
    })),
    groups: shownGroups.map(([group, canView]) => ({
      id: group.id,
      name: group.name,
      memberCount: counts.get(group.id) ?? 0,
      canView,
    })),
  }
}

// ---------------------------------------------------------------------------
// Needs your attention
// ---------------------------------------------------------------------------

export type AttentionKind = 'review-requested' | 'changes-requested' | 'review-approved'

export interface AttentionItem {
  readonly kind: AttentionKind
  readonly requestId: string
  readonly document: {
    readonly id: string
    readonly shortId: string
    readonly title: string
    readonly workspaceId: string
  }
  readonly by: PersonRef
  readonly at: Date
}

export interface GetAttentionCommand {
  readonly userId: UserId
  /** Decides which documents the caller may still open; one that is not visible is left out. */
  readonly authorizer: Authorizer
}

interface AttentionCandidate {
  readonly kind: AttentionKind
  readonly request: ReviewRequestRow
  readonly by: string
  readonly at: Date
}

/**
 * What is waiting on this person: requests assigned to them or a group they
 * are in, and answers to the requests they made. A document the caller can no
 * longer view is omitted rather than named.
 */
export async function getAttention(
  deps: Pick<ReviewDependencies, 'uow'>,
  command: GetAttentionCommand,
): Promise<readonly AttentionItem[]> {
  const { repos } = deps.uow
  const groupIds = [...(await heldGroupIds(repos, command.userId))]
  const [awaiting, answered] = await Promise.all([
    repos.reviews.listAwaiting({ userId: command.userId, groupIds, limit: ATTENTION_LIMIT * 2 }),
    repos.reviews.listAnswered({ userId: command.userId, limit: ATTENTION_LIMIT * 2 }),
  ])
  const answers = await repos.reviews.listAssignments(answered.map((row) => row.id))

  const candidates: AttentionCandidate[] = awaiting.map((request) => ({
    kind: 'review-requested',
    request,
    by: request.requestedBy,
    at: request.createdAt,
  }))
  for (const request of answered) {
    const wanted: AssignmentState = request.status === 'approved' ? 'approved' : 'changes_requested'
    const latest = answers
      .flatMap((answer) =>
        answer.requestId === request.id &&
        answer.state === wanted &&
        answer.decidedBy !== null &&
        answer.decidedAt !== null
          ? [{ by: answer.decidedBy, at: answer.decidedAt }]
          : [],
      )
      .toSorted((left, right) => right.at.getTime() - left.at.getTime())[0]
    if (latest === undefined) continue
    candidates.push({
      kind: request.status === 'approved' ? 'review-approved' : 'changes-requested',
      request,
      ...latest,
    })
  }

  const newest = candidates.toSorted((left, right) => right.at.getTime() - left.at.getTime())
  // At most twice the limit, and the authorizer memoises each document, so
  // asking about all of them at once costs no more than asking one by one.
  const verdicts = await Promise.all(
    newest.map((candidate) => command.authorizer.document(candidate.request.documentId)),
  )
  const visible = newest
    .flatMap((candidate, index): { candidate: AttentionCandidate; document: DocumentRow }[] => {
      const access = verdicts[index]
      return access?.ok === true && access.value.capabilities.view
        ? [{ candidate, document: access.value.document }]
        : []
    })
    .slice(0, ATTENTION_LIMIT)

  const people = await repos.users.listByIds([
    ...new Set(visible.map(({ candidate }) => candidate.by as UserId)),
  ])
  const names = new Map<string, string>(people.map((person) => [person.id, person.displayName]))
  return visible.map(({ candidate, document }) => ({
    kind: candidate.kind,
    requestId: candidate.request.id,
    document: {
      id: document.id,
      shortId: document.shortId,
      title: document.title,
      workspaceId: document.workspaceId,
    },
    by: { id: candidate.by, name: names.get(candidate.by) ?? FORMER_MEMBER },
    at: candidate.at,
  }))
}
