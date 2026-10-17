/**
 * Review requests (ADR-052): the vocabulary and the one rule that is pure.
 *
 * A request is *active* while it can still be answered: `open`, or `approved`
 * and `changes_requested`, which are what an active request is called once its
 * reviewers have spoken. `withdrawn`, `superseded` and `published` are closed
 * for good.
 */

export const REVIEW_STATUSES = [
  'open',
  'approved',
  'changes_requested',
  'withdrawn',
  'superseded',
  'published',
] as const

export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

export const ASSIGNMENT_STATES = ['pending', 'approved', 'changes_requested'] as const

export type AssignmentState = (typeof ASSIGNMENT_STATES)[number]

export type ReviewDecision = 'approve' | 'request_changes'

/** A reviewer is a person or a group; a group is answered by any one member. */
export type ReviewerKind = 'user' | 'group'

export function isActiveReviewStatus(status: ReviewStatus): boolean {
  return status === 'open' || status === 'approved' || status === 'changes_requested'
}

export function assignmentStateFor(decision: ReviewDecision): AssignmentState {
  return decision === 'approve' ? 'approved' : 'changes_requested'
}

/**
 * Where an active request stands: any request for changes wins, otherwise it
 * is approved only once everybody has approved.
 */
export function deriveReviewStatus(
  states: readonly AssignmentState[],
): 'open' | 'approved' | 'changes_requested' {
  if (states.includes('changes_requested')) return 'changes_requested'
  if (states.length > 0 && states.every((state) => state === 'approved')) return 'approved'
  return 'open'
}
