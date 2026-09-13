import type { RevisionSummary } from '../api/index.ts'

/**
 * What a reader calls a revision.
 *
 * Revisions are 40-character hex strings and are never shown as such: the
 * artboard's readout says `v12`, which is a *position in this document's
 * history* rather than anything the content store knows. That number can only
 * be counted when the whole history is in hand, so a paged history falls back
 * to the short hash, which is always true. Nothing here guesses.
 */

/** How much of a revision hash identifies it to a person. */
const SHORT_REVISION_LENGTH = 7

export interface LabelledRevision {
  readonly revision: string
  /** `v12` when the whole history is known, otherwise the short hash. */
  readonly label: string
  /** `YYYY-MM-DD`, for a `<time datetime>`. */
  readonly date: string
  readonly summary: string
  readonly changeNote: string | undefined
  readonly authorName: string
}

export function shortRevision(revision: string): string {
  return revision.slice(0, SHORT_REVISION_LENGTH)
}

/** The date part of an ISO timestamp, which is what every readout shows. */
export function revisionDate(timestamp: string): string {
  return timestamp.slice(0, 10)
}

export interface LabelRevisionsOptions {
  /**
   * True when the history page held every revision this document has, which
   * is the only case in which a position can be counted from it.
   */
  readonly complete: boolean
}

/**
 * Labels a newest-first page of revisions. Position `n` of `total` counts
 * down, so the newest revision is `v{total}` and the first publish is `v1`.
 */
export function labelRevisions(
  revisions: readonly RevisionSummary[],
  options: LabelRevisionsOptions,
): readonly LabelledRevision[] {
  return revisions.map((revision, index) => ({
    revision: revision.revision,
    label: options.complete ? `v${revisions.length - index}` : shortRevision(revision.revision),
    date: revisionDate(revision.timestamp),
    summary: revision.summary,
    changeNote: revision.changeNote,
    authorName: revision.author.name,
  }))
}
