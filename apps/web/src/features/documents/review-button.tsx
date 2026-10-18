import { Button } from '@quill/ui'

import { DraftChangesCard } from './draft-changes-card.tsx'
import { useDraftChanges, type DraftChangesOptions } from './use-draft-changes.ts'

export interface ReviewButtonProps extends DraftChangesOptions {
  /** Opens the comparison of the published page with the draft, at a change or at the start. */
  readonly onReview: (change?: string) => void
}

/**
 * "Changes since published: N": the editor's way into what is waiting, for the pointer and
 * the keyboard alike. It opens the comparison of the published page with the draft, where
 * each change can be read, and put back as it was. Its panel lists them first.
 *
 * Always in the bar once there is a published page to compare with, so it does not come and
 * go as the author types; with nothing waiting it stays, `aria-disabled`, and says so.
 */
export function ReviewButton({ onReview, ...draft }: ReviewButtonProps) {
  const changes = useDraftChanges(draft)
  const count = changes.described?.empty === false ? changes.total : undefined
  return (
    <DraftChangesCard
      changes={changes}
      title="Changes since published"
      whenNone="No changes since this was last published."
      whenUnknown="Couldn’t check what has changed. The comparison shows the draft as last saved."
      onReview={onReview}
    >
      <Button
        size="sm"
        variant="ghost"
        aria-disabled={changes.nothing || undefined}
        aria-describedby={changes.descriptionId}
        className="aria-disabled:cursor-default aria-disabled:opacity-50"
        onClick={() => {
          if (!changes.nothing) onReview()
        }}
      >
        {count === undefined ? 'Changes since published' : `Changes since published: ${count}`}
      </Button>
    </DraftChangesCard>
  )
}
