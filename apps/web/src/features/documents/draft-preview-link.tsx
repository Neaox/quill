import { DraftChangesCard } from './draft-changes-card.tsx'
import { PreviewLink } from './preview-link.tsx'
import { useDraftChanges, type DraftChangesOptions } from './use-draft-changes.ts'

export interface DraftPreviewLinkProps extends DraftChangesOptions {
  /** Finishes what the page it opens needs: the edits not yet saved. */
  readonly beforeOpen: () => Promise<void>
  /** Opens the review of what the preview shows, from its panel. */
  readonly onReview?: ((change?: string) => void) | undefined
}

/**
 * Preview of the draft, and what it would show that the published page does not.
 *
 * What is being previewed is the unpublished changes, so they are what its panel lists:
 * the same account as Publish's, from the same comparison.
 */
export function DraftPreviewLink({ beforeOpen, onReview, ...draft }: DraftPreviewLinkProps) {
  const changes = useDraftChanges(draft)
  return (
    <DraftChangesCard
      changes={changes}
      title="What the preview shows"
      whenNone="No unpublished changes, so the preview matches the published page."
      whenUnknown="Couldn’t check what has changed. The preview shows the draft as last saved."
      {...(onReview === undefined ? {} : { onReview })}
    >
      <PreviewLink
        documentRef={draft.documentId}
        draft
        beforeOpen={beforeOpen}
        title={null}
        aria-describedby={changes.descriptionId}
        variant="ghost"
        size="sm"
      />
    </DraftChangesCard>
  )
}
