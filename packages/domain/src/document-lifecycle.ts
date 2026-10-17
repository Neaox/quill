import { DOCUMENT_STATUSES } from './document-status.ts'

/**
 * Where a document stands in its life, as its author or owner says it
 * (ADR-005 amendment of 2026-10-17, `docs/design/properties.md`).
 *
 * Three questions used to share the one word "status", and they have
 * different answers from different people:
 *
 * - **Publication** — never published, published, or published with changes
 *   not yet published — is the system's to say, from the document's head
 *   revision and its draft. It is not in front matter at all.
 * - **Lifecycle** — in review, verified, deprecated, or nothing — is the
 *   author's or owner's to say. It is front matter's `status`, and it is
 *   optional: most documents never carry one, and they show nothing.
 * - **Freshness** — review due, review overdue — is computed from the review
 *   cycle, so it can never be wrong because somebody forgot to change it.
 *   "Needs update" is this, never a value somebody sets.
 *
 * Earlier releases wrote `status: draft`, `published` or `archived`, which
 * were publication words in a lifecycle place. They are kept in the file
 * exactly as written (AGENTS.md rule 7) and are never read as a lifecycle:
 * a reader is not told a document is a draft because its front matter said
 * so in 2025. The editor shows them, read-only, where every unmodelled value
 * is shown.
 *
 * Pure, like `document-facts.ts`: the server reads it for every surface and
 * the editor for the draft, so they agree on what a value means.
 */

/** The lifecycle states, in the order a menu offers them. */
export const LIFECYCLE_STATES = ['in-review', 'verified', 'deprecated'] as const

export type LifecycleState = (typeof LIFECYCLE_STATES)[number]

/**
 * `status` values from before the lifecycle existed. Recognised so that they
 * are described for what they are, never so that they mean anything.
 */
export const LEGACY_STATUSES: readonly string[] = DOCUMENT_STATUSES

export function isLifecycleState(value: unknown): value is LifecycleState {
  return typeof value === 'string' && (LIFECYCLE_STATES as readonly string[]).includes(value)
}

/**
 * What a document's lifecycle says, with what each state carries.
 *
 * `verifiedBy` is whatever was written — an email address, as owners are —
 * and is named as a person only by a surface that may show people.
 * `supersededBy` is a document reference (AGENTS.md rule 8), resolved by
 * each surface into an address its reader may follow, or into nothing.
 */
export type DocumentLifecycle =
  | { readonly state: 'in-review' }
  | {
      readonly state: 'verified'
      readonly verifiedBy: string | undefined
      /** `YYYY-MM-DD`, only when it is a real date. */
      readonly verifiedAt: string | undefined
    }
  | { readonly state: 'deprecated'; readonly supersededBy: string | undefined }

/** The lifecycle states in words, for every surface. */
const LABELS: Readonly<Record<LifecycleState, string>> = {
  'in-review': 'In review',
  verified: 'Verified',
  deprecated: 'Deprecated',
}

export function lifecycleLabel(state: LifecycleState): string {
  return LABELS[state]
}

/** Why a deprecated document cannot be verified, said beside the choice that is disabled. */
export const DEPRECATED_CANNOT_BE_VERIFIED =
  'A deprecated page cannot be verified. Mark it in review first if it is coming back.'

/**
 * Whether a lifecycle may move to `next`.
 *
 * Only one move is refused: deprecated straight to verified. Verifying says
 * "this is right, rely on it", and a page its owner has just said not to
 * rely on has to come back through review first. The extension point for
 * approval workflows — who may verify, whether a review must be requested —
 * is this function's caller (ADR-005 amendment; a later milestone).
 */
export function canMoveLifecycle(
  current: LifecycleState | undefined,
  next: LifecycleState | undefined,
): boolean {
  return !(current === 'deprecated' && next === 'verified')
}

/**
 * How many days before a review falls due a reader is told it is due. Long
 * enough for an owner to schedule it, short enough not to be noise.
 */
export const REVIEW_DUE_SOON_DAYS = 14

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Freshness: whether the review cycle says this document needs looking at. */
export type ReviewFreshness = 'current' | 'due' | 'overdue'

export function reviewFreshness(dueAt: Date, now: Date): ReviewFreshness {
  const remaining = dueAt.getTime() - now.getTime()
  if (remaining < 0) return 'overdue'
  return remaining <= REVIEW_DUE_SOON_DAYS * MS_PER_DAY ? 'due' : 'current'
}
