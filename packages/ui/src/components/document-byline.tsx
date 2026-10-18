import { useId, type ReactNode } from 'react'

import { cx } from '../lib/class-names.ts'
import { absoluteDate, relativeDate } from '../lib/dates.ts'
import { PlainLink, type LinkComponent, type LinkTarget } from '../lib/link.tsx'
import { Avatar } from './avatar.tsx'
import { WarningIcon } from './icons.tsx'
import { RelativeTime } from './relative-time.tsx'

/**
 * The byline: the one quiet line under a document's title that says who owns
 * it, what state it is in, and whether it is current
 * (`docs/design/properties.md`).
 *
 * One component for every surface that shows a document in the application —
 * the reading view, the share page, and the editor, which wraps each value in
 * the control that edits it — and one stylesheet shared with the public site's
 * server template (`@quill/design-css/byline.css`), so the four cannot drift.
 * Its classes are that stylesheet's rather than utilities for the same reason.
 *
 * It is a description list: each fact a term and a value, the terms read by
 * assistive technology and hidden from sight, because the value already says
 * what it is ("Reviewed 3 months ago"). A fact that is not set takes no room,
 * and a document that states nothing has no byline at all.
 */

/** Which fact a value is, for a caller that wraps values in controls. */
export type BylineField = 'owners' | 'lifecycle' | 'type' | 'updated' | 'review' | 'tags'

/**
 * Where the document stands, as its author or owner said (ADR-005 amendment):
 * in review, verified, or deprecated. A verification says who (a person's
 * name, never an address; absent where people are not shown) and when, and
 * whether it has lapsed — which the caller works out from the review cycle,
 * because the file still says `verified` when it has.
 */
export type BylineLifecycle =
  | { readonly state: 'in-review' }
  | {
      readonly state: 'verified'
      readonly by?: string | undefined
      readonly at?: Date | undefined
      readonly lapsed?: boolean | undefined
    }
  | { readonly state: 'deprecated' }

const LIFECYCLE_WORDS = {
  'in-review': 'In review',
  verified: 'Verified',
  deprecated: 'Deprecated',
  lapsed: 'Verification lapsed',
} as const

export interface BylineOwner {
  /** A person's name, or a value that is not a person (a team) as written. */
  readonly label: string
  readonly person: boolean
}

export interface DocumentBylineProps {
  readonly owners?: readonly BylineOwner[] | undefined
  readonly lifecycle?: BylineLifecycle | undefined
  readonly type?: string | undefined
  /** When the head revision was published. */
  readonly updatedAt?: Date | undefined
  readonly lastReviewed?: Date | undefined
  /** `soon` when it falls due within the fortnight (`reviewFreshness`): said, a step louder. */
  readonly reviewDue?: ReviewDue | undefined
  /**
   * How often it is reviewed, in words ("6 months"), for a document whose next
   * review cannot be dated yet: the editor's, before a first review.
   */
  readonly reviewEvery?: string | undefined
  readonly tags?: readonly string[] | undefined
  /**
   * The moment relative dates are counted from. Absent, every date is
   * absolute: a page served from a cache has no now (`footer.ts` on the
   * public site follows the same rule).
   */
  readonly now?: Date | undefined
  /** Where a tag leads: the search for it. Absent, tags are words. */
  readonly tagTarget?: ((tag: string) => LinkTarget) | undefined
  readonly linkComponent?: LinkComponent | undefined
  /** Wraps a fact's value, so the editor can make each one the control that edits it. */
  readonly renderValue?: ((field: BylineField, value: ReactNode) => ReactNode) | undefined
  /** Entries after the facts: the editor's "Add property". */
  readonly children?: ReactNode
  readonly label?: string | undefined
  readonly className?: string | undefined
}

/** A label's name, as the theme validates it (ADR-037); a tag that could be one carries it. */
const LABEL_NAME = /^[a-z][a-z0-9-]{0,31}$/u

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function When({ date, now }: { readonly date: Date; readonly now: Date | undefined }) {
  const exact = absoluteDate(date)
  return (
    <time dateTime={isoDay(date)} {...(now === undefined ? {} : { title: exact })}>
      {now === undefined ? exact : relativeDate(date, now)}
    </time>
  )
}

/**
 * The review, as one fact: when it last happened and when it is next due, or
 * how often it happens when neither can be dated yet. One fact rather than
 * three so it reads as one sentence and is one thing to edit.
 */
function Review({
  lastReviewed,
  reviewDue,
  reviewEvery,
  now,
}: {
  readonly lastReviewed: Date | undefined
  readonly reviewDue: ReviewDue | undefined
  readonly reviewEvery: string | undefined
  readonly now: Date | undefined
}) {
  const reviewed =
    lastReviewed === undefined ? undefined : (
      <span>
        Reviewed <When date={lastReviewed} now={now} />
      </span>
    )
  const next =
    reviewDue === undefined ? undefined : reviewDue.overdue ? (
      <span data-overdue="" className="byline-overdue">
        <WarningIcon />
        <span>
          Review overdue, due <When date={reviewDue.at} now={now} />
        </span>
      </span>
    ) : reviewDue.soon === true ? (
      <span className="byline-due">
        Review due <When date={reviewDue.at} now={now} />
      </span>
    ) : (
      <span>
        {reviewed === undefined ? 'Review due' : 'next due'} <When date={reviewDue.at} now={now} />
      </span>
    )
  const cycle =
    reviewEvery === undefined || next !== undefined ? undefined : (
      <span>
        {reviewed === undefined ? 'Review every' : 'every'} {reviewEvery}
      </span>
    )
  const parts = [reviewed, next, cycle].filter((part) => part !== undefined)
  return (
    <span className="byline-review">
      {parts.map((part, index) => (
        <span key={index} className="byline-review-part">
          {part}
        </span>
      ))}
    </span>
  )
}

interface ReviewDue {
  readonly at: Date
  readonly overdue: boolean
  readonly soon?: boolean | undefined
}

/** The lifecycle's lozenge, and who verified it and when where that is said. */
function Lifecycle({
  lifecycle,
  now,
}: {
  readonly lifecycle: BylineLifecycle
  readonly now: Date | undefined
}) {
  const tone =
    lifecycle.state === 'verified' && lifecycle.lapsed === true ? 'lapsed' : lifecycle.state
  const lozenge = (
    <span data-lifecycle={tone} className="byline-lifecycle">
      {LIFECYCLE_WORDS[tone]}
    </span>
  )
  if (lifecycle.state !== 'verified' || tone === 'lapsed') return lozenge
  const parts = [
    lifecycle.by === undefined ? undefined : <span key="by">by {lifecycle.by}</span>,
    lifecycle.at === undefined ? undefined : <When key="at" date={lifecycle.at} now={now} />,
  ].filter((part) => part !== undefined)
  if (parts.length === 0) return lozenge
  return (
    <>
      {lozenge}
      <span className="byline-verification">
        {parts.map((part) => (
          <span key={part.key} className="byline-verification-part">
            {part}
          </span>
        ))}
      </span>
    </>
  )
}

interface Fact {
  readonly field: BylineField
  readonly term: string
  readonly value: ReactNode
}

export function DocumentByline({
  owners = [],
  lifecycle,
  type,
  updatedAt,
  lastReviewed,
  reviewDue,
  reviewEvery,
  tags = [],
  now,
  tagTarget,
  linkComponent: LinkElement = PlainLink,
  renderValue = (_field, value) => value,
  children,
  label = 'Document properties',
  className,
}: DocumentBylineProps) {
  const ids = useId()

  const facts: readonly Fact[] = [
    ...(owners.length === 0
      ? []
      : [
          {
            field: 'owners',
            term: 'Owners',
            value: (
              <ul aria-label="Owners" className="byline-list">
                {owners.map((owner) => (
                  <li key={owner.label} data-person={owner.person} className="byline-person">
                    <Avatar name={owner.label} />
                    {owner.label}
                  </li>
                ))}
              </ul>
            ),
          } satisfies Fact,
        ]),
    ...(lifecycle === undefined
      ? []
      : [
          {
            field: 'lifecycle',
            term: 'Lifecycle',
            value: <Lifecycle lifecycle={lifecycle} now={now} />,
          } satisfies Fact,
        ]),
    ...(type === undefined ? [] : [{ field: 'type', term: 'Type', value: type } satisfies Fact]),
    ...(updatedAt === undefined
      ? []
      : [
          {
            field: 'updated',
            term: 'Updated',
            value: (
              <span>
                {/* A moment, not a day: said as every other "how long ago" in the application
                    is, and kept true as time passes. The review's dates are calendar days and
                    are counted in whole days (`When`). */}
                Updated{' '}
                {now === undefined ? (
                  <When date={updatedAt} now={now} />
                ) : (
                  <RelativeTime value={updatedAt} />
                )}
              </span>
            ),
          } satisfies Fact,
        ]),
    ...(lastReviewed === undefined && reviewDue === undefined && reviewEvery === undefined
      ? []
      : [
          {
            field: 'review',
            term: 'Review',
            value: (
              <Review
                lastReviewed={lastReviewed}
                reviewDue={reviewDue}
                reviewEvery={reviewEvery}
                now={now}
              />
            ),
          } satisfies Fact,
        ]),
    ...(tags.length === 0
      ? []
      : [
          {
            field: 'tags',
            term: 'Tags',
            value: (
              <ul aria-label="Tags" className="byline-list">
                {tags.map((tag) => {
                  const labelled = LABEL_NAME.test(tag) ? { 'data-label': tag } : {}
                  return (
                    <li key={tag}>
                      {tagTarget === undefined ? (
                        <span className="byline-tag badge" {...labelled}>
                          {tag}
                        </span>
                      ) : (
                        <TagLink
                          target={tagTarget(tag)}
                          tag={tag}
                          labelled={LABEL_NAME.test(tag)}
                          linkComponent={LinkElement}
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            ),
          } satisfies Fact,
        ]),
  ]

  if (facts.length === 0 && children === undefined) return undefined

  return (
    <div role="group" aria-label={label} className={cx('byline', className)}>
      {facts.length === 0 ? undefined : (
        <dl className="byline-facts">
          {facts.map((fact) => (
            <div key={fact.field} className="byline-fact">
              <dt id={`${ids}-${fact.field}`} className="byline-term">
                {fact.term}
              </dt>
              <dd className="byline-value">{renderValue(fact.field, fact.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </div>
  )
}

/**
 * A tag's link. It carries the label hook — `badge` with `data-label`, which
 * the theme's label rule colours (ADR-037) — through the link seam, so the
 * router's anchor is the element the rule matches.
 */
function TagLink({
  target,
  tag,
  labelled,
  linkComponent: LinkElement,
}: {
  readonly target: LinkTarget
  readonly tag: string
  readonly labelled: boolean
  readonly linkComponent: LinkComponent
}) {
  return (
    <LinkElement
      {...target}
      className="byline-tag badge"
      {...(labelled ? { 'data-label': tag } : {})}
    >
      {tag}
    </LinkElement>
  )
}
