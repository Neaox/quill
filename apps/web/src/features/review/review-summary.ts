import type { BadgeTone } from '@quill/ui'

/** What the summary reads of a request: the status and who has answered. */
export interface ReviewLike {
  readonly status:
    | 'open'
    | 'approved'
    | 'changes_requested'
    | 'withdrawn'
    | 'superseded'
    | 'published'
  /** The draft has changed since the request was made. */
  readonly stale: boolean
  readonly assignments: readonly { readonly state: 'pending' | 'approved' | 'changes_requested' }[]
}

export interface ReviewSummary {
  readonly label: string
  /** What fits where the bar is short of room: the state without its counts. */
  readonly short: string
  readonly tone: BadgeTone
}

/**
 * The review in a few words, for the chip in a document's header. A request that is over
 * (withdrawn, replaced, or published) is not a state the document is in, so it has none.
 */
export function summariseReview(review: ReviewLike | null): ReviewSummary | undefined {
  if (review === null) return undefined
  switch (review.status) {
    case 'open': {
      const approved = review.assignments.filter(({ state }) => state === 'approved').length
      const label = `In review · ${String(approved)} of ${String(review.assignments.length)} approved`
      return {
        label: review.stale ? `${label} · changed since` : label,
        short: 'In review',
        tone: 'accent',
      }
    }
    case 'approved':
      return { label: 'Approved', short: 'Approved', tone: 'success' }
    case 'changes_requested':
      return { label: 'Changes requested', short: 'Changes asked', tone: 'warning' }
    case 'withdrawn':
    case 'superseded':
    case 'published':
      return undefined
  }
}
