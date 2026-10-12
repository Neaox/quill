import { Button } from '@quill/ui'

import { useDraftChanges, type DraftChangesOptions } from './use-draft-changes.ts'

export interface ReviewButtonProps extends DraftChangesOptions {
  readonly onReview: () => void
}

/**
 * The way into the review of what is waiting, for everyone: the panels on Publish and
 * Preview offer the same for the pointer, and are not reachable by keyboard. Offered only
 * while there is something to review.
 */
export function ReviewButton({ onReview, ...draft }: ReviewButtonProps) {
  const { described } = useDraftChanges(draft)
  if (described?.empty !== false) return undefined
  return (
    <Button size="sm" variant="ghost" onClick={onReview}>
      Review changes
    </Button>
  )
}
