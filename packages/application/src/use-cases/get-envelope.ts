import type { Capabilities, DocumentId, RevisionId, UserId } from '@quill/domain'

import type { DocumentSource } from '../ports/content-store.ts'
import type { DocumentLockRow, DocumentRow } from '../ports/persistence.ts'
import type { RenderDocumentDependencies } from './render-document.ts'
import { renderSource } from './render-document.ts'
import { canonicaliseLinks } from './canonical-links.ts'
import { readSource } from './read-published.ts'
import { readDraftContent } from './publish-document.ts'

/**
 * The live envelope (ADR-031).
 *
 * Everything here is a property of now rather than of the revision: who holds
 * the lock, what the reader may do, when the document is next due for review,
 * and the quiet quality signals. It is fetched per request and never cached
 * with the body, which is why the body can be cached for ever.
 */

/** The envelope reads the same cached body the reader is about to be shown. */
export type EnvelopeDependencies = RenderDocumentDependencies

export interface GetEnvelopeCommand {
  readonly documentId: DocumentId
  /** Already resolved by the authorizer for this request; the envelope reports it. */
  readonly capabilities: Capabilities
}

export interface LockView {
  readonly holderUserId: UserId
  readonly holderName: string
  readonly expiresAt: Date
}

export interface LastPublishedView {
  readonly revision: RevisionId
  readonly author: string
  readonly at: Date
}

export interface ReviewView {
  readonly dueAt: Date
  readonly overdue: boolean
}

export type HealthSignalKind =
  | 'no-owner'
  | 'review-overdue'
  | 'required-section-empty'
  | 'broken-link'

export interface HealthSignal {
  readonly kind: HealthSignalKind
  readonly detail?: string | undefined
}

/** A draft that says something the published page does not (an editor's to see and to resume). */
export interface DraftView {
  /** When it was last saved. */
  readonly savedAt: Date
}

export interface EnvelopeView {
  readonly permissions: {
    readonly view: boolean
    readonly comment: boolean
    readonly edit: boolean
    readonly manage: boolean
  }
  readonly lock: LockView | null
  readonly lastPublished: LastPublishedView | null
  /** Unpublished changes, for somebody who may edit; null for everybody else and when there are none. */
  readonly draft: DraftView | null
  readonly review: ReviewView | null
  readonly health: readonly HealthSignal[]
}

export type GetEnvelopeResult =
  | { readonly kind: 'envelope'; readonly envelope: EnvelopeView }
  | { readonly kind: 'not-found'; readonly documentId: DocumentId }

export async function getEnvelope(
  deps: EnvelopeDependencies,
  command: GetEnvelopeCommand,
): Promise<GetEnvelopeResult> {
  const { repos } = deps.uow
  // The document row and its published source are read once, here, and
  // carried down: an envelope reports the lock, the last publish, the review
  // date, and the health of one document, and reading that document three
  // times over is three times the work for the same answer.
  const document = await repos.documents.findById(command.documentId)
  if (document === null) return { kind: 'not-found', documentId: command.documentId }

  const now = deps.clock.now()
  const [lock, latest, source] = await Promise.all([
    repos.locks.find(command.documentId),
    repos.revisions.latestForDocument(command.documentId),
    readSource(deps, document.workspaceId, { documentId: command.documentId }),
  ])

  const permissions = {
    view: command.capabilities.view,
    comment: command.capabilities.comment,
    edit: command.capabilities.edit,
    manage: command.capabilities.manage,
  }
  const lockView = await toLockView(deps, lock, now)
  const lastPublished =
    latest === null
      ? null
      : { revision: latest.revision, author: latest.authorName, at: latest.timestamp }

  const unpublished = permissions.edit
    ? await unpublishedDraft(deps, document, source, latest)
    : null

  if (source === null) {
    return {
      kind: 'envelope',
      envelope: {
        permissions,
        lock: lockView,
        lastPublished,
        draft: unpublished,
        review: null,
        health: [],
      },
    }
  }

  const { frontMatter } = deps.format.read(source.markdown)
  const review = reviewOf(frontMatter, lastPublished?.at ?? null, now)
  return {
    kind: 'envelope',
    envelope: {
      permissions,
      lock: lockView,
      lastPublished,
      draft: unpublished,
      review,
      health: await healthOf(deps, document, source, frontMatter, review),
    },
  }
}

/**
 * The draft, when it says something the published page does not.
 *
 * Publishing leaves the draft where it is, so a draft existing says nothing; what
 * says something is whether it differs from what is published, as its next
 * publish would write it (the comparison's rule, so a link pasted in its readable
 * form is not a difference). A draft not saved since the last publish cannot
 * differ, which is asked first because it is a comparison of two dates and the
 * other is a serialisation.
 */
async function unpublishedDraft(
  deps: EnvelopeDependencies,
  document: DocumentRow,
  source: DocumentSource | null,
  latest: { readonly timestamp: Date } | null,
): Promise<DraftView | null> {
  const draft = await deps.uow.repos.drafts.find(document.id)
  const content = draft === null ? null : readDraftContent(draft.ast)
  if (draft === null || content === null) return null
  if (latest !== null && draft.updatedAt.getTime() <= latest.timestamp.getTime()) return null
  if (source !== null) {
    const prepared = deps.format.prepareForPublish({ documentId: document.id, content })
    const markdown = await canonicaliseLinks(deps.uow.repos.documents, prepared.markdown)
    if (markdown === source.markdown) return null
  }
  return { savedAt: draft.updatedAt }
}

/**
 * Who is editing, or null.
 *
 * A lock nobody has heartbeaten within its lifetime is gone, whether or not
 * anything has swept the row away (ADR-021 sweeps nothing): reporting it would
 * tell a reader that a document is being edited when it is not, and would grey
 * out an edit button that would in fact work. The comparison is a strict
 * less-than, so an exact-millisecond tie is not expired.
 */
async function toLockView(
  deps: EnvelopeDependencies,
  lock: DocumentLockRow | null,
  now: Date,
): Promise<LockView | null> {
  if (lock === null || lock.expiresAt.getTime() < now.getTime()) return null
  const holder = await deps.uow.repos.users.findById(lock.holderUserId)
  return {
    holderUserId: lock.holderUserId,
    holderName: holder?.displayName ?? 'Unknown',
    expiresAt: lock.expiresAt,
  }
}

const INTERVAL = /^([1-9][0-9]*)([a-z])$/
const DAYS = { d: 1, w: 7, m: 30, y: 365 } as const
const MS_PER_DAY = 24 * 60 * 60 * 1000

type IntervalUnit = keyof typeof DAYS

function isIntervalUnit(value: string): value is IntervalUnit {
  return value in DAYS
}

/**
 * When this document is next due for review.
 *
 * The interval comes from front matter (`review.interval`, ADR-005) and is
 * counted from the last recorded review, or from the last publish when the
 * document has never been reviewed — a document nobody has looked at since it
 * was written is exactly the one a review interval is for.
 */
export function reviewOf(
  frontMatter: Record<string, unknown>,
  lastPublishedAt: Date | null,
  now: Date,
): ReviewView | null {
  const review = frontMatter['review']
  if (typeof review !== 'object' || review === null) return null
  const { interval, lastReviewed } = review as { interval?: unknown; lastReviewed?: unknown }
  if (typeof interval !== 'string') return null
  const [, count, unit] = INTERVAL.exec(interval) ?? []
  if (count === undefined || unit === undefined || !isIntervalUnit(unit)) return null

  const from = readDate(lastReviewed) ?? lastPublishedAt
  if (from === null) return null

  const days = Number(count) * DAYS[unit]
  const dueAt = new Date(from.getTime() + days * MS_PER_DAY)
  return { dueAt, overdue: dueAt.getTime() < now.getTime() }
}

/**
 * A date from front matter, whatever the YAML parser made of it.
 *
 * `lastReviewed: 2026-01-01` comes back as a `Date` and `"2026-01-01"` as a
 * string, depending only on how the author quoted it, and a review date is a
 * review date either way.
 */
function readDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'string') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * The quiet quality indicators shown beside a document.
 *
 * Every one of them is a fact about the published document, never an error:
 * a required section left empty and a link to a document that no longer
 * exists are shown the same way as "no owner" (ADR-029).
 */
async function healthOf(
  deps: EnvelopeDependencies,
  document: DocumentRow,
  source: DocumentSource,
  frontMatter: Record<string, unknown>,
  review: ReviewView | null,
): Promise<readonly HealthSignal[]> {
  const signals: HealthSignal[] = []

  const owners = frontMatter['owners']
  if (!Array.isArray(owners) || owners.length === 0) signals.push({ kind: 'no-owner' })
  if (review?.overdue === true) signals.push({ kind: 'review-overdue' })

  // The body this reader is about to be shown, rendered from the row and the
  // source already in hand rather than by reading the document again.
  const rendered = await renderSource(deps, document, source)
  for (const heading of rendered.content.incompleteRequiredSections) {
    signals.push({ kind: 'required-section-empty', detail: heading })
  }

  const links = await deps.uow.repos.documentLinks.listForDocument(document.id)
  for (const link of links) {
    if (link.kind === 'document' && link.targetDocumentId === null) {
      signals.push({ kind: 'broken-link', detail: link.url })
    }
  }

  return signals
}
