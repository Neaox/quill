import {
  isLifecycleState,
  type DocumentLifecycle,
  type LifecycleState,
} from './document-lifecycle.ts'
import { isDocumentStatus, type DocumentStatus } from './document-status.ts'

/**
 * The facts a document states about itself, as a reader is shown them
 * (`docs/design/properties.md`, ADR-055).
 *
 * Front matter is whatever its author wrote (ADR-005): a value can be the wrong
 * type, a status the schema does not know, an interval nobody can count. The
 * byline shows only what it can say truthfully, so this reads the record
 * defensively — a value that is not what its field means is left out here,
 * and it is the editor, not the reader, that says what is wrong with it.
 *
 * Pure: the server reads it for the envelope, the share page and the public
 * site, and the editor reads it for the draft, so every surface agrees on what
 * a document says.
 */
export interface DocumentFacts {
  /**
   * A `status` from before the lifecycle (`draft`, `published`, `archived`).
   * Still read, so the API stays additive (ADR-033), and shown to nobody: a
   * reader is told a document's lifecycle, and its publication comes from
   * its revisions (`document-lifecycle.ts`).
   */
  readonly status: DocumentStatus | undefined
  /** In review, verified or deprecated, with what each carries; nothing when unset. */
  readonly lifecycle: DocumentLifecycle | undefined
  readonly type: string | undefined
  /** As written: an email address for a person, or a team's name. */
  readonly owners: readonly string[]
  readonly tags: readonly string[]
  /** A count and a unit (`90d`, `6m`, `1y`), only when it is one. */
  readonly reviewInterval: string | undefined
  /** `YYYY-MM-DD`, only when it is a real date. */
  readonly lastReviewed: string | undefined
}

/**
 * The lifecycle as an outsider is told it: never who verified (a person,
 * ADR-055), and a verification only while it stands — the review cycle that
 * would say it has lapsed is internal, so a lapsed one is simply not claimed.
 */
export type PublicLifecycle =
  | { readonly state: 'in-review' }
  | { readonly state: 'verified'; readonly verifiedAt: string | undefined }
  | { readonly state: 'deprecated'; readonly supersededBy: string | undefined }

/** What a reader outside the organisation sees: no people, no internal cadence. */
export interface PublicDocumentFacts {
  /** A legacy status other than `published`; kept on the wire, shown to nobody. */
  readonly status: Exclude<DocumentStatus, 'published'> | undefined
  readonly lifecycle: PublicLifecycle | undefined
  readonly tags: readonly string[]
  readonly lastReviewed: string | undefined
}

const REVIEW_INTERVAL = /^([1-9]\d*)([dwmy])$/u
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/** A list of words, deduplicated in the order written; a lone string counts as a list of one. */
function words(value: unknown): readonly string[] {
  const entries = Array.isArray(value) ? value : [value]
  return [...new Set(entries.map(text).filter((entry) => entry !== undefined))]
}

/** Whether `value` is a count and a unit the review cycle can count with. */
export function isReviewInterval(value: unknown): value is string {
  return typeof value === 'string' && REVIEW_INTERVAL.test(value)
}

/**
 * A calendar date in the form front matter writes, or `undefined`.
 *
 * YAML 1.2 leaves `2026-03-01` a string; a 1.1 parser makes it a `Date`. Both
 * are a date somebody wrote, so both are read, and neither is trusted to be a
 * real day: `2026-02-30` is not one.
 */
export function calendarDate(value: unknown): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10)
  }
  const written = text(value)
  if (written === undefined) return undefined
  const [, year, month, day] = ISO_DATE.exec(written) ?? []
  if (year === undefined || month === undefined || day === undefined) return undefined
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  return date.toISOString().slice(0, 10) === written ? written : undefined
}

/**
 * The lifecycle front matter states, or `undefined` for none — which is also
 * what a legacy or unknown `status` is (`document-lifecycle.ts`). What a
 * state carries is read only for that state: a `verified` block left beside
 * `status: in-review` says nothing.
 */
function lifecycleOf(
  frontMatter: Readonly<Record<string, unknown>>,
): DocumentLifecycle | undefined {
  const state: unknown = frontMatter['status']
  if (!isLifecycleState(state)) return undefined
  switch (state) {
    case 'in-review':
      return { state }
    case 'verified': {
      const verified = isRecord(frontMatter['verified']) ? frontMatter['verified'] : {}
      return {
        state,
        verifiedBy: text(verified['by']),
        verifiedAt: calendarDate(verified['at']),
      }
    }
    case 'deprecated':
      return { state, supersededBy: text(frontMatter['supersededBy']) }
  }
}

export function documentFacts(frontMatter: Readonly<Record<string, unknown>>): DocumentFacts {
  const review = isRecord(frontMatter['review']) ? frontMatter['review'] : {}
  const status = frontMatter['status']
  const interval = review['interval']
  return {
    status: isDocumentStatus(status) ? status : undefined,
    lifecycle: lifecycleOf(frontMatter),
    type: text(frontMatter['type']),
    owners: words(frontMatter['owners']),
    tags: words(frontMatter['tags']),
    reviewInterval: isReviewInterval(interval) ? interval : undefined,
    lastReviewed: calendarDate(review['lastReviewed']),
  }
}

/**
 * What an outsider is told, at `now`: the public facts, and a verification
 * only while it stands.
 */
export function publicDocumentFacts(facts: DocumentFacts, now: Date): PublicDocumentFacts {
  return {
    status: facts.status === 'published' ? undefined : facts.status,
    lifecycle: publicLifecycle(facts, now),
    tags: facts.tags,
    lastReviewed: facts.lastReviewed,
  }
}

function publicLifecycle(facts: DocumentFacts, now: Date): PublicLifecycle | undefined {
  const lifecycle = facts.lifecycle
  if (lifecycle?.state !== 'verified') return lifecycle
  if (verificationLapsed(lifecycle, reviewDueAt(facts), now)) return undefined
  return { state: 'verified', verifiedAt: lifecycle.verifiedAt }
}

/**
 * When the review cycle next falls due, from what the record itself says:
 * the last review, or else the verification, which is a review too. A
 * surface that knows more — the envelope knows the last publish — passes its
 * own date to `verificationLapsed` instead.
 */
export function reviewDueAt(facts: DocumentFacts): Date | undefined {
  const from =
    facts.lastReviewed ??
    (facts.lifecycle?.state === 'verified' ? facts.lifecycle.verifiedAt : undefined)
  if (from === undefined || facts.reviewInterval === undefined) return undefined
  return nextReviewDue(facts.reviewInterval, new Date(`${from}T00:00:00Z`))
}

/**
 * Whether a verification has lapsed: the review it promised has fallen
 * overdue. Nothing is written when it does — the file still says `verified`
 * and who and when — so it comes back the moment the review is done.
 * A document with no review cycle has nothing to lapse against.
 */
export function verificationLapsed(
  lifecycle: { readonly state: LifecycleState } | undefined,
  dueAt: Date | undefined,
  now: Date,
): boolean {
  return lifecycle?.state === 'verified' && dueAt !== undefined && dueAt.getTime() < now.getTime()
}

const DAYS_PER_UNIT = { d: 1, w: 7, m: 30, y: 365 } as const
const MS_PER_DAY = 24 * 60 * 60 * 1000
const UNIT_WORDS = { d: 'day', w: 'week', m: 'month', y: 'year' } as const

function parts(
  interval: string,
): { readonly count: number; readonly unit: 'd' | 'w' | 'm' | 'y' } | undefined {
  const [, count, unit] = REVIEW_INTERVAL.exec(interval) ?? []
  if (count === undefined || (unit !== 'd' && unit !== 'w' && unit !== 'm' && unit !== 'y')) {
    return undefined
  }
  return { count: Number(count), unit }
}

/** When a review cycle that started at `from` next falls due, or `undefined` for no interval. */
export function nextReviewDue(interval: string, from: Date): Date | undefined {
  const parsed = parts(interval)
  if (parsed === undefined) return undefined
  return new Date(from.getTime() + parsed.count * DAYS_PER_UNIT[parsed.unit] * MS_PER_DAY)
}

/** An interval in words: `6m` is "6 months", `1y` is "1 year". The input when it is not one. */
export function describeInterval(interval: string): string {
  const parsed = parts(interval)
  if (parsed === undefined) return interval
  const word = UNIT_WORDS[parsed.unit]
  return `${parsed.count} ${parsed.count === 1 ? word : `${word}s`}`
}

/**
 * The search for everything with this tag, in the search language's own
 * syntax (ADR-010): `tag:ops`, or `tag:"On call"` for a tag a space would
 * otherwise cut in two, with `\\` and `\"` as the only escapes.
 */
export function tagQuery(tag: string): string {
  if (!/[\s"\\]/u.test(tag)) return `tag:${tag}`
  return `tag:"${tag.replaceAll(/["\\]/gu, (character) => `\\${character}`)}"`
}

/** A status as a reader reads it: "Draft", "Published", "Archived". */
export function statusLabel(status: DocumentStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}
