import { useState } from 'react'

import { describeInterval, reviewFreshness, tagQuery, verificationLapsed } from '@quill/domain'
import {
  DocumentByline,
  LifecycleNotice,
  type BylineLifecycle,
  type LinkComponent,
} from '@quill/ui'

import type { DocumentEnvelope, SharedDocument } from '../../../lib/api/index.ts'
import { RouterLink } from '../../../lib/routing/router-link.tsx'
import { now as wallClock } from '../../../lib/time/clock.ts'

/**
 * The byline under a document's title, from what the server says the
 * published revision states about itself (`docs/design/properties.md`), and
 * for a deprecated document the notice that says so under it.
 *
 * The reading route carries this, so it is light on purpose: `DocumentByline`
 * and `LifecycleNotice` from the design system and a few pure functions from
 * the domain, nothing from the editor.
 */

type Facts = DocumentEnvelope['facts']
type PublicFacts = SharedDocument['facts']
type Lifecycle = NonNullable<Facts['lifecycle']> | NonNullable<PublicFacts['lifecycle']>

/** A calendar date from front matter, as the instant at the start of its day in UTC. */
function day(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(`${value}T00:00:00Z`)
}

/**
 * The lifecycle as the byline draws it. A verification lapses when the
 * review it promised is overdue (`verificationLapsed`), worked out here at
 * the moment it is shown, because the file never changes when it happens.
 */
function bylineLifecycle(
  lifecycle: Lifecycle | undefined,
  dueAt: Date | undefined,
  now: Date,
): BylineLifecycle | undefined {
  if (lifecycle === undefined) return undefined
  if (lifecycle.state !== 'verified') return { state: lifecycle.state }
  return {
    state: 'verified',
    by: 'verifiedBy' in lifecycle ? lifecycle.verifiedBy?.label : undefined,
    at: day(lifecycle.verifiedAt),
    lapsed: verificationLapsed(lifecycle, dueAt, now),
  }
}

/** The notice under a deprecated document's byline, its replacement as the server resolved it. */
function Notice({
  lifecycle,
  linkComponent,
}: {
  readonly lifecycle: Lifecycle | undefined
  readonly linkComponent: LinkComponent
}) {
  if (lifecycle?.state !== 'deprecated') return undefined
  const { replacement } = lifecycle
  return (
    <LifecycleNotice
      replacement={
        replacement === undefined
          ? undefined
          : { target: { to: replacement.href }, title: replacement.title }
      }
      linkComponent={linkComponent}
    />
  )
}

export interface FactsBylineProps {
  readonly workspaceSlug: string
  /** Undefined while the envelope is on its way. */
  readonly facts: Facts | undefined
  readonly review: DocumentEnvelope['review'] | undefined
  /** When the head revision was published. */
  readonly updatedAt: string | undefined
  readonly now?: Date | undefined
  readonly linkComponent?: LinkComponent | undefined
  readonly className?: string | undefined
}

/** What a member reads: owners named, relative dates, tags that lead to their search. */
export function FactsByline({
  workspaceSlug,
  facts,
  review,
  updatedAt,
  now: given,
  linkComponent = RouterLink,
  className,
}: FactsBylineProps) {
  // Read once: "3 days ago" should not tick while somebody reads it.
  const [opened] = useState(() => new Date(wallClock()))
  const now = given ?? opened
  if (facts === undefined) return undefined
  const dueAt = review === null || review === undefined ? undefined : new Date(review.dueAt)
  return (
    <>
      <DocumentByline
        owners={facts.owners}
        lifecycle={bylineLifecycle(facts.lifecycle, dueAt, now)}
        type={facts.type}
        updatedAt={updatedAt === undefined ? undefined : new Date(updatedAt)}
        lastReviewed={day(facts.lastReviewed)}
        reviewDue={
          review === null || review === undefined || dueAt === undefined
            ? undefined
            : {
                at: dueAt,
                overdue: review.overdue,
                soon: !review.overdue && reviewFreshness(dueAt, now) === 'due',
              }
        }
        reviewEvery={
          facts.reviewInterval === undefined ? undefined : describeInterval(facts.reviewInterval)
        }
        tags={facts.tags}
        now={now}
        tagTarget={(tag) => ({
          to: '/w/$workspaceSlug/search',
          params: { workspaceSlug },
          search: { q: tagQuery(tag) },
        })}
        linkComponent={linkComponent}
        className={className}
      />
      <Notice lifecycle={facts.lifecycle} linkComponent={linkComponent} />
    </>
  )
}

/**
 * What someone holding a share link reads: the public facts only, in absolute
 * dates, and tags as words — there is no search on the other side of a link
 * (ADR-052). The server has already left out a lapsed verification and any
 * replacement outside the link's scope.
 */
export function PublicFactsByline({
  facts,
  linkComponent = RouterLink,
  className,
}: {
  readonly facts: PublicFacts | undefined
  readonly linkComponent?: LinkComponent | undefined
  readonly className?: string | undefined
}) {
  const [opened] = useState(() => new Date(wallClock()))
  if (facts === undefined) return undefined
  return (
    <>
      <DocumentByline
        lifecycle={bylineLifecycle(facts.lifecycle, undefined, opened)}
        lastReviewed={day(facts.lastReviewed)}
        tags={facts.tags}
        className={className}
      />
      <Notice lifecycle={facts.lifecycle} linkComponent={linkComponent} />
    </>
  )
}
