import type { AssignmentState, DocumentId, ReviewerKind, ReviewStatus, UserId } from '@quill/domain'

/** A group's id as the persistence ports spell it (`persistence.ts`, which imports this port). */
type GroupId = string

/**
 * What a search for somebody to ask needs of a person or a group: enough to name them. Declared
 * here rather than borrowed from `persistence.ts`, which imports this port.
 */
export interface PersonMatch {
  readonly id: UserId
  readonly displayName: string
  readonly email: string
}

export interface GroupMatch {
  readonly id: GroupId
  readonly name: string
}

/**
 * Review requests as they are stored (ADR-052).
 *
 * A request asks named people and groups to look at a draft as it stood when
 * the request was made. `draftVersion` is that moment: the draft is stale
 * when its current version differs, which costs nothing on the write path.
 */

export type ReviewRequestId = string
export type ReviewAssignmentId = string

export interface ReviewRequestRow {
  readonly id: ReviewRequestId
  readonly documentId: DocumentId
  readonly requestedBy: UserId
  readonly draftVersion: number
  readonly message: string | null
  readonly status: ReviewStatus
  readonly createdAt: Date
  /** When the request stopped being active; null while it is. */
  readonly closedAt: Date | null
}

export interface ReviewAssignmentRow {
  readonly id: ReviewAssignmentId
  readonly requestId: ReviewRequestId
  readonly principalKind: ReviewerKind
  /** A user id or a group id, by `principalKind`. */
  readonly principalId: string
  readonly state: AssignmentState
  /** The member who answered, which for a group is whoever got there first. */
  readonly decidedBy: UserId | null
  readonly comment: string | null
  readonly decidedAt: Date | null
}

export interface NewReviewRequest {
  readonly id: ReviewRequestId
  readonly documentId: DocumentId
  readonly requestedBy: UserId
  readonly draftVersion: number
  readonly message: string | null
  readonly reviewers: readonly {
    readonly id: ReviewAssignmentId
    readonly kind: ReviewerKind
    readonly principalId: string
  }[]
  readonly now: Date
}

export interface ReviewRepository {
  /** Inserts the request and its assignments (all pending) together, in reviewer order. */
  create(input: NewReviewRequest): Promise<ReviewRequestRow>
  findById(id: ReviewRequestId): Promise<ReviewRequestRow | null>
  /** The request that can still be answered: at most one per document. */
  findActiveForDocument(documentId: DocumentId): Promise<ReviewRequestRow | null>
  /** The active request, or failing that the one most recently made. */
  findLatestForDocument(documentId: DocumentId): Promise<ReviewRequestRow | null>
  /** Moves a request to a status; a closed status stamps `closedAt`. */
  setStatus(id: ReviewRequestId, status: ReviewStatus, now: Date): Promise<ReviewRequestRow | null>
  /** Assignments of several requests, grouped by request and in reviewer order. */
  listAssignments(requestIds: readonly ReviewRequestId[]): Promise<readonly ReviewAssignmentRow[]>
  /** Records one person's answer against each of the given assignments. */
  recordDecision(input: {
    readonly assignmentIds: readonly ReviewAssignmentId[]
    readonly state: AssignmentState
    readonly decidedBy: UserId
    readonly comment: string | null
    readonly now: Date
  }): Promise<void>
  /**
   * Active requests with a pending assignment naming this person or one of
   * their groups, made by somebody else, newest first.
   */
  listAwaiting(input: {
    readonly userId: UserId
    readonly groupIds: readonly GroupId[]
    readonly limit: number
  }): Promise<readonly ReviewRequestRow[]>
  /** This person's active requests that reviewers have answered, newest first. */
  listAnswered(input: {
    readonly userId: UserId
    readonly limit: number
  }): Promise<readonly ReviewRequestRow[]>
  /** People matching `query` by name, name order, cut at `limit`. An empty query matches all. */
  searchPeople(query: string, limit: number): Promise<readonly PersonMatch[]>
  /** Groups matching `query` by name, name order, cut at `limit`. */
  searchGroups(query: string, limit: number): Promise<readonly GroupMatch[]>
  /** Distinct people in each group, counting the groups nested inside it. */
  countGroupMembers(groupIds: readonly GroupId[]): Promise<ReadonlyMap<GroupId, number>>
  /** Distinct people in any of the groups or the groups nested inside them, in one query. */
  listMemberIdsDeep(groupIds: readonly GroupId[]): Promise<readonly UserId[]>
}
