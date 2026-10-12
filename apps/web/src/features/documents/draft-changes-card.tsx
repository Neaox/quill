import type { ReactNode } from 'react'

import { HoverCard } from '@quill/ui'

import type { ChangeItem, DescribedChanges } from './publish-changes.ts'
import { STILL_SAVING, type DraftChanges } from './use-draft-changes.ts'

type Review = ((change?: string) => void) | undefined

function ChangeSummary({ described, onReview }: { described: DescribedChanges; onReview: Review }) {
  return (
    <>
      <p>
        {described.headline}
        {described.words === '' ? undefined : <> · {described.words}</>}
      </p>
      {described.items.length === 0 ? undefined : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {described.items.map((item) => (
            <li key={`${item.kind}:${item.where}:${item.excerpt}`}>
              {onReview === undefined || item.id === undefined ? (
                <ChangeLines item={item} />
              ) : (
                <ReviewChange item={item} id={item.id} onReview={onReview} />
              )}
            </li>
          ))}
        </ul>
      )}
      {described.more === 0 ? undefined : (
        <p className="mt-2 text-muted">…and {described.more} more</p>
      )}
    </>
  )
}

function ChangeLines({ item }: { item: ChangeItem }) {
  return (
    <span className="flex flex-col">
      <span className="font-medium text-foreground">
        {item.kind} · {item.where}
        {item.by === undefined ? undefined : <> · {item.by}</>}
      </span>
      <span className="truncate text-muted">{item.excerpt}</span>
    </span>
  )
}

/** One change, which opens in the review: a way in for the pointer, which the Review button is for the keyboard. */
function ReviewChange({
  item,
  id,
  onReview,
}: {
  item: ChangeItem
  id: string
  onReview: (change?: string) => void
}) {
  return (
    <button
      type="button"
      className="w-full rounded-sm text-start hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus-ring"
      onClick={() => {
        onReview(id)
      }}
    >
      <ChangeLines item={item} />
    </button>
  )
}

function Waiting({
  changes,
  whenUnknown,
  onReview,
}: {
  changes: DraftChanges
  whenUnknown: string
  onReview: Review
}) {
  const { described, unsaved, failed } = changes
  if (described === undefined) return <p>{failed ? whenUnknown : 'Checking what has changed…'}</p>
  return (
    <>
      {described.empty ? undefined : <ChangeSummary described={described} onReview={onReview} />}
      {unsaved ? <p className="mt-2 text-muted">{STILL_SAVING}</p> : undefined}
    </>
  )
}

export interface DraftChangesCardProps {
  readonly changes: DraftChanges
  /** The panel's heading: what the control is about to do with these changes. */
  readonly title: string
  /** What it says when there are none. */
  readonly whenNone: string
  /** What it says when it could not find out. */
  readonly whenUnknown: string
  /** Opens the review of the changes, at one of them or at the first. Omitted, the list is only read. */
  readonly onReview?: (change?: string) => void
  /** The control, given `changes.descriptionId` as its `aria-describedby`. */
  readonly children: ReactNode
}

/**
 * A control, and a panel of the unpublished changes it concerns, for the pointer or focus.
 *
 * A hover card is not announced, so the same account is carried by a visually hidden
 * element the control points at. One panel for Publish and for the draft preview: what
 * is about to be published and what is about to be previewed are the same changes.
 */
export function DraftChangesCard({
  changes,
  title,
  whenNone,
  whenUnknown,
  onReview,
  children,
}: DraftChangesCardProps) {
  return (
    <>
      <HoverCard
        title={title}
        content={
          changes.nothing ? (
            <p>{whenNone}</p>
          ) : (
            <Waiting changes={changes} whenUnknown={whenUnknown} onReview={onReview} />
          )
        }
      >
        {children}
      </HoverCard>
      <span id={changes.descriptionId} className="sr-only">
        {changes.nothing ? whenNone : changes.description}
      </span>
    </>
  )
}
