import { useState, type ReactNode } from 'react'

import { Button, Callout, Dialog, DialogClose, Textarea, toast } from '@quill/ui'

import { useRequestReview, type ReviewRequestDto } from '../../lib/api/index.ts'
import { FormError } from '../../lib/forms/form-error.tsx'
import { ReviewerPicker, type ChosenReviewer } from './reviewer-picker.tsx'

/** The longest message a request carries (ADR-052). */
export const MESSAGE_LIMIT = 1000

export interface RequestReviewDialogProps {
  readonly documentId: string
  readonly title: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The request already open on the document, which this one replaces. */
  readonly current: ReviewRequestDto | null
  /** The person asking could publish it themselves: the words say a review is optional. */
  readonly canPublish: boolean
  /**
   * What must be true before the request is made: in the editor, the words typed so far have
   * reached the server, because a review is of the draft as it is saved.
   */
  readonly beforeSubmit?: (() => Promise<void>) | undefined
  /** What the reviewers will see, when the page asking knows. */
  readonly summary?: ReactNode
}

/**
 * Asking people and groups to look at a draft before it goes live (ADR-052).
 *
 * The same dialog serves the writer who cannot publish, for whom this is the way to get the
 * change live, and the one who can, who wants a second pair of eyes first; the words differ
 * and nothing else does. Asking again while a request is open replaces it, and the dialog
 * says so before it does.
 */
export function RequestReviewDialog({
  documentId,
  title,
  open,
  onOpenChange,
  current,
  canPublish,
  beforeSubmit,
  summary,
}: RequestReviewDialogProps) {
  const [chosen, setChosen] = useState<readonly ChosenReviewer[]>([])
  const [message, setMessage] = useState('')
  const [preparing, setPreparing] = useState(false)
  const request = useRequestReview(documentId)
  const replacing = current?.status === 'open'

  async function submit() {
    setPreparing(true)
    try {
      await beforeSubmit?.()
    } catch {
      setPreparing(false)
      return
    }
    setPreparing(false)
    request.mutate(
      {
        reviewers: chosen.map(({ kind, id }) => ({ kind, id })),
        message,
      },
      {
        onSuccess: () => {
          toast.success(`Review requested for ${title}`, {
            description:
              chosen.length === 1
                ? `${chosen[0]?.name ?? 'The reviewer'} has been asked.`
                : `${String(chosen.length)} reviewers have been asked.`,
          })
          setChosen([])
          setMessage('')
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!request.isPending && !preparing) onOpenChange(next)
      }}
      title="Request a review"
      description={
        canPublish
          ? 'Ask for a second pair of eyes before you publish. Reviewers see what you have changed and can approve it or ask for changes.'
          : 'Reviewers see what you have changed and can approve it or ask for changes. Once it is approved, somebody who can publish makes it live.'
      }
      footer={
        <>
          <DialogClose>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button
            size="sm"
            loading={request.isPending || preparing}
            aria-disabled={chosen.length === 0 || undefined}
            onClick={() => {
              if (chosen.length === 0) return
              void submit()
            }}
          >
            {replacing ? 'Ask again' : 'Request review'}
          </Button>
        </>
      }
    >
      {replacing ? (
        <Callout tone="info" title="A review is already open">
          Asking again replaces it: the people already asked are told it has moved on.
        </Callout>
      ) : undefined}
      {summary}
      <ReviewerPicker documentId={documentId} chosen={chosen} onChange={setChosen} />
      <Textarea
        label="Message (optional)"
        description="What would help them: what changed, or what to look at."
        maxLength={MESSAGE_LIMIT}
        value={message}
        onChange={(event) => {
          setMessage(event.target.value)
        }}
      />
      {chosen.length === 0 ? (
        <p className="text-2xs text-muted">Choose at least one person or group to ask.</p>
      ) : undefined}
      <FormError error={request.error} />
    </Dialog>
  )
}
