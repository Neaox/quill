import type { DocumentId, RevisionId } from '@quill/domain'

import type { UnitOfWork } from '../ports/persistence.ts'

/**
 * A document's history (ADR-014, ADR-015).
 *
 * History comes from the Postgres revisions index, not from a walk of the
 * repository: one document's history at twenty thousand revisions takes
 * tens of seconds to walk and a lookup to read, which is why the index is on
 * the critical path rather than a cache. The page limit is mandatory for the
 * same reason.
 */

const DEFAULT_HISTORY_LIMIT = 25
export const MAX_HISTORY_LIMIT = 100

export interface HistoryDependencies {
  readonly uow: UnitOfWork
}

export interface GetHistoryCommand {
  readonly documentId: DocumentId
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
}

export interface RevisionSummaryView {
  readonly revision: RevisionId
  readonly author: { readonly name: string; readonly email: string }
  readonly timestamp: Date
  readonly summary: string
  readonly changeNote?: string | undefined
}

export interface HistoryPageView {
  readonly revisions: readonly RevisionSummaryView[]
  /** Absent when this is the last page. */
  readonly nextCursor?: string | undefined
}

export async function getHistory(
  deps: HistoryDependencies,
  command: GetHistoryCommand,
): Promise<HistoryPageView> {
  // Clamped from both ends: a limit of zero or of minus one is a page nobody
  // can use, and the repository would read it as "no rows" or as an error
  // rather than as the request it plainly is.
  const limit = Math.max(
    1,
    Math.min(Math.trunc(command.limit ?? DEFAULT_HISTORY_LIMIT), MAX_HISTORY_LIMIT),
  )
  // One row beyond the page answers "is there more?" without a second count.
  const rows = await deps.uow.repos.revisions.listForDocument(command.documentId, {
    limit: limit + 1,
    cursor: command.cursor,
  })

  const page = rows.slice(0, limit)
  const last = page.at(-1)
  const hasMore = rows.length > limit && last !== undefined

  return {
    revisions: page.map((row) => ({
      revision: row.revision,
      author: { name: row.authorName, email: row.authorEmail },
      timestamp: row.timestamp,
      summary: row.summary,
      ...(row.changeNote === null ? {} : { changeNote: row.changeNote }),
    })),
    ...(hasMore ? { nextCursor: last.id } : {}),
  }
}
