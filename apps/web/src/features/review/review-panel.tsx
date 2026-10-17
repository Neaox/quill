import { useState } from 'react'

import {
  Badge,
  Button,
  Callout,
  CheckIcon,
  Dialog,
  DialogClose,
  RelativeTime,
  Textarea,
  UserIcon,
  UsersIcon,
  tv,
  toast,
  type BadgeTone,
} from '@quill/ui'

import {
  useDecideReview,
  useWithdrawReview,
  type ReviewAssignmentDto,
  type ReviewRequestDto,
} from '../../lib/api/index.ts'
import { FormError } from '../../lib/forms/form-error.tsx'
import { MESSAGE_LIMIT } from './request-review-dialog.tsx'

export const reviewPanelStyles = tv({
  slots: {
    ask: 'flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2.5',
    askMeta: 'text-2xs text-muted',
    message: 'whitespace-pre-wrap text-sm text-foreground',
    list: 'flex flex-col divide-y divide-border rounded-md border border-border',
    row: 'flex items-start gap-3 px-3 py-2.5',
    rowIcon: 'mt-0.5 size-4 shrink-0 text-muted',
    rowBody: 'flex min-w-0 grow flex-col gap-0.5',
    rowName: 'flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-foreground',
    rowComment: 'whitespace-pre-wrap text-xs text-foreground-soft',
    rowMeta: 'text-2xs text-muted',
    form: 'flex flex-col gap-3 border-t border-border pt-4',
    actions: 'flex flex-wrap gap-2',
  },
})

const STATE: Record<
  ReviewAssignmentDto['state'],
  { readonly label: string; readonly tone: BadgeTone }
> = {
  pending: { label: 'Waiting', tone: 'neutral' },
  approved: { label: 'Approved', tone: 'success' },
  changes_requested: { label: 'Changes requested', tone: 'warning' },
}

export interface ReviewPanelProps {
  readonly documentId: string
  readonly title: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly review: ReviewRequestDto
  /** Opens the request dialog again, to change who is asked. */
  readonly onAskAgain?: (() => void) | undefined
  /** What the reviewer is reading: the changes themselves, which the page knows how to show. */
  readonly onSeeChanges?: (() => void) | undefined
}

/**
 * One review request: who asked, what they said, who has answered and how, and, for somebody
 * the request was addressed to, the two answers (ADR-052).
 *
 * Everybody sees every answer: a review is a conversation the author and the reviewers share,
 * and a group's answer says which of its members gave it.
 */
export function ReviewPanel({
  documentId,
  title,
  open,
  onOpenChange,
  review,
  onAskAgain,
  onSeeChanges,
}: ReviewPanelProps) {
  const styles = reviewPanelStyles()
  const [comment, setComment] = useState('')
  const decide = useDecideReview(documentId)
  const withdraw = useWithdrawReview(documentId)

  function answer(decision: 'approve' | 'request_changes') {
    decide.mutate(
      { decision, comment },
      {
        onSuccess: () => {
          setComment('')
          toast.success(
            decision === 'approve' ? `Approved ${title}` : `Asked for changes to ${title}`,
          )
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Review"
      description={`Changes to ${title}`}
      footer={
        <>
          {review.canWithdraw ? (
            <Button
              variant="ghost"
              size="sm"
              loading={withdraw.isPending}
              onClick={() => {
                withdraw.mutate(undefined, {
                  onSuccess: () => {
                    toast.success('Review withdrawn')
                    onOpenChange(false)
                  },
                })
              }}
            >
              Withdraw request
            </Button>
          ) : undefined}
          {review.status === 'open' && onAskAgain !== undefined ? (
            <Button variant="secondary" size="sm" onClick={onAskAgain}>
              Change who is asked
            </Button>
          ) : undefined}
          <DialogClose>
            <Button variant="ghost" size="sm">
              Close
            </Button>
          </DialogClose>
        </>
      }
    >
      {review.stale ? (
        <Callout tone="warning" title="The draft has changed since this was requested">
          Answers below were given about an earlier version.
        </Callout>
      ) : undefined}

      <div className={styles.ask()}>
        <p className={styles.askMeta()}>
          {review.requestedBy.name} asked <RelativeTime value={review.createdAt} />
        </p>
        {review.message === null ? undefined : <p className={styles.message()}>{review.message}</p>}
        {onSeeChanges === undefined ? undefined : (
          <div className="pt-1">
            <Button variant="secondary" size="sm" onClick={onSeeChanges}>
              See the changes
            </Button>
          </div>
        )}
      </div>

      <ul aria-label="Reviewers" className={styles.list()}>
        {review.assignments.map((assignment) => (
          <li key={assignment.id} className={styles.row()}>
            {assignment.reviewer.kind === 'group' ? (
              <UsersIcon className={styles.rowIcon()} />
            ) : (
              <UserIcon className={styles.rowIcon()} />
            )}
            <div className={styles.rowBody()}>
              <p className={styles.rowName()}>
                {assignment.reviewer.name}
                <Badge tone={STATE[assignment.state].tone}>
                  {assignment.state === 'approved' ? <CheckIcon className="size-3" /> : undefined}
                  {STATE[assignment.state].label}
                </Badge>
              </p>
              {assignment.decidedBy === null ? (
                assignment.reviewer.kind === 'group' ? (
                  <p className={styles.rowMeta()}>Any one member can answer</p>
                ) : undefined
              ) : (
                <p className={styles.rowMeta()}>
                  {assignment.reviewer.kind === 'group'
                    ? `${assignment.decidedBy.name} answered`
                    : 'Answered'}
                  {assignment.decidedAt === null ? undefined : (
                    <>
                      {' '}
                      <RelativeTime value={assignment.decidedAt} />
                    </>
                  )}
                </p>
              )}
              {assignment.comment === null ? undefined : (
                <p className={styles.rowComment()}>{assignment.comment}</p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {review.canDecide ? (
        <div className={styles.form()}>
          <Textarea
            label="Your comment (optional)"
            maxLength={MESSAGE_LIMIT}
            value={comment}
            onChange={(event) => {
              setComment(event.target.value)
            }}
          />
          <FormError error={decide.error} />
          <div className={styles.actions()}>
            <Button
              size="sm"
              loading={decide.isPending && decide.variables?.decision === 'approve'}
              disabled={decide.isPending}
              onClick={() => {
                answer('approve')
              }}
            >
              Approve
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={decide.isPending && decide.variables?.decision === 'request_changes'}
              disabled={decide.isPending}
              onClick={() => {
                answer('request_changes')
              }}
            >
              Request changes
            </Button>
          </div>
        </div>
      ) : undefined}
      <FormError error={withdraw.error} />
    </Dialog>
  )
}
