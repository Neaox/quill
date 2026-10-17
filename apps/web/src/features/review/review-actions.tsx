import { useNavigate } from '@tanstack/react-router'
import { lazy, useState, type ReactNode } from 'react'

import { Badge, Button } from '@quill/ui'

import { DRAFT_SIDE } from '../../lib/api/content.ts'
import { useReview } from '../../lib/api/index.ts'
import { MountOnFirstOpen } from '../../lib/mount-on-first-open.tsx'
import { comparisonLink } from '../../lib/routing/document-reference.ts'
import { summariseReview } from './review-summary.ts'

const RequestReviewDialog = lazy(async () => ({
  default: (await import('./request-review-dialog.tsx')).RequestReviewDialog,
}))
const ReviewPanel = lazy(async () => ({
  default: (await import('./review-panel.tsx')).ReviewPanel,
}))

export interface ReviewActionsProps {
  readonly workspaceSlug: string
  readonly documentId: string
  readonly title: string
  /** What the person may do here, from the document's envelope. */
  readonly canEdit: boolean
  readonly canPublish: boolean
  /** The revision on the page now, which the draft is compared with; null when there is none yet. */
  readonly published: string | null
  /** See `RequestReviewDialog`: the editor saves what is typed before a request is made. */
  readonly beforeRequest?: (() => Promise<void>) | undefined
  readonly summary?: ReactNode
  /**
   * Who is the primary action here. A writer who cannot publish asks for a review as their
   * way to get a change live; one who can, asks as a courtesy, so it stays secondary.
   */
  readonly primary?: boolean | undefined
  /**
   * Whether the request dialog is open, for a page that opens it from somewhere else too. The
   * request button shows from `sm`: a phone's bar has no room for it, so there the page offers
   * it in the document's menu and opens the dialog through this. Omitted, the button's own
   * press opens it.
   */
  readonly requesting?: boolean | undefined
  readonly onRequestingChange?: ((open: boolean) => void) | undefined
}

/**
 * Where a document's review shows and is acted on: a status chip that opens the review, and
 * the button that starts one (ADR-052).
 *
 * The chip is for everybody the review concerns: the one who asked, the reviewers, and anybody
 * else who can see that it is in review. The button is for those who can write.
 */
export function ReviewActions({
  workspaceSlug,
  documentId,
  title,
  canEdit,
  canPublish,
  published,
  beforeRequest,
  summary,
  primary = false,
  requesting,
  onRequestingChange,
}: ReviewActionsProps) {
  const review = useReview(documentId)
  const navigate = useNavigate()
  const [askingHere, setAskingHere] = useState(false)
  const asking = requesting ?? askingHere
  const setAsking = onRequestingChange ?? setAskingHere
  const [reading, setReading] = useState(false)
  const current = review.data ?? null
  const status = summariseReview(current)
  const open = current?.status === 'open'

  return (
    <>
      {status === undefined || current === null ? undefined : (
        <Button
          variant={current.canDecide ? 'secondary' : 'ghost'}
          size="sm"
          aria-label={`Review: ${status.label}`}
          onClick={() => {
            setReading(true)
          }}
        >
          <Badge tone={status.tone}>
            <span className="sm:hidden">{status.short}</span>
            <span className="max-sm:hidden">{status.label}</span>
          </Badge>
        </Button>
      )}

      {canEdit && !open ? (
        <Button
          variant={primary ? 'primary' : 'secondary'}
          size="sm"
          className="max-sm:hidden"
          onClick={() => {
            setAsking(true)
          }}
        >
          Request review
        </Button>
      ) : undefined}

      {canEdit ? (
        <MountOnFirstOpen open={asking}>
          <RequestReviewDialog
            documentId={documentId}
            title={title}
            open={asking}
            onOpenChange={setAsking}
            current={current}
            canPublish={canPublish}
            beforeSubmit={beforeRequest}
            summary={summary}
          />
        </MountOnFirstOpen>
      ) : undefined}

      {current === null || status === undefined ? undefined : (
        <MountOnFirstOpen open={reading}>
          <ReviewPanel
            documentId={documentId}
            title={title}
            open={reading}
            onOpenChange={setReading}
            review={current}
            onAskAgain={
              canEdit
                ? () => {
                    setReading(false)
                    setAsking(true)
                  }
                : undefined
            }
            // The changes are read on the comparison page, the published page against the
            // draft, which a reviewer may open while the request is theirs (ADR-052).
            onSeeChanges={() => {
              setReading(false)
              void navigate(
                comparisonLink(workspaceSlug, documentId, {
                  ...(published === null ? {} : { from: published }),
                  to: DRAFT_SIDE,
                }),
              )
            }}
          />
        </MountOnFirstOpen>
      )}
    </>
  )
}
