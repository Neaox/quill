import { lazy, Suspense, useState, type ReactNode } from 'react'

import { Badge, Button, tv } from '@quill/ui'

import { useReview } from '../../lib/api/index.ts'
import { MountOnFirstOpen } from '../../lib/mount-on-first-open.tsx'
import { summariseReview } from './review-summary.ts'

/**
 * The comparison is the heaviest part of reading a review and only a reviewer who asks to
 * see it needs it, so it is a chunk of its own rather than part of every reading page.
 */
const ChangesReview = lazy(async () => ({
  default: (await import('../documents/changes-review.tsx')).ChangesReview,
}))

const RequestReviewDialog = lazy(async () => ({
  default: (await import('./request-review-dialog.tsx')).RequestReviewDialog,
}))
const ReviewPanel = lazy(async () => ({
  default: (await import('./review-panel.tsx')).ReviewPanel,
}))

/** Where the request button shows: the header from `sm`, or the phone's notice below it. */
const requestButton = tv({
  variants: { surface: { notice: 'sm:hidden', header: 'max-sm:hidden' } },
})

export interface ReviewActionsProps {
  readonly documentId: string
  readonly title: string
  /** What the person may do here, from the document's envelope. */
  readonly canEdit: boolean
  readonly canPublish: boolean
  /** The revision on the page now, which the draft is compared with; undefined when there is none yet. */
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
   * Where it is drawn. The header holds the status chip and, from `sm`, the request button; a
   * phone's bar has no room for both, so there the button lives in the notice that says there
   * are unpublished changes (`'notice'`), which shows only below `sm`.
   */
  readonly surface?: 'header' | 'notice' | undefined
}

/**
 * Where a document's review shows and is acted on: a status chip that opens the review, and
 * the button that starts one (ADR-052).
 *
 * The chip is for everybody the review concerns: the one who asked, the reviewers, and anybody
 * else who can see that it is in review. The button is for those who can write.
 */
export function ReviewActions({
  documentId,
  title,
  canEdit,
  canPublish,
  published,
  beforeRequest,
  summary,
  primary = false,
  surface = 'header',
}: ReviewActionsProps) {
  const review = useReview(documentId)
  const [asking, setAsking] = useState(false)
  const [reading, setReading] = useState(false)
  const [comparing, setComparing] = useState(false)
  const current = review.data ?? null
  const status = summariseReview(current)
  const open = current?.status === 'open'

  return (
    <>
      {surface === 'notice' || status === undefined || current === null ? undefined : (
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
          className={requestButton({ surface })}
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

      {surface === 'notice' || current === null || status === undefined ? undefined : (
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
            onSeeChanges={() => {
              setReading(false)
              setComparing(true)
            }}
          />
        </MountOnFirstOpen>
      )}

      {comparing && current !== null ? (
        <Suspense>
          <ChangesReview
            documentId={documentId}
            published={published}
            saved={current.draftVersion}
            open
            onOpenChange={(next) => {
              if (!next) setComparing(false)
            }}
            revert={{
              allowed: false,
              reason: 'Changes can be put back only while editing the draft.',
              run: () => Promise.resolve(),
            }}
          />
        </Suspense>
      ) : undefined}
    </>
  )
}
