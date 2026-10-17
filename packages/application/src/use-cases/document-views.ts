import type { DocumentId, UserId, WorkspaceId } from '@quill/domain'

import type { UnitOfWork } from '../ports/persistence.ts'
import type { Clock } from '../ports/system.ts'

/**
 * What a person has opened, kept for them (ADR-053).
 *
 * A view is the person's own record: it feeds their home and nothing else, is
 * never counted across people, and can be cleared by them. Opening a document
 * is the most frequent thing anyone does, so a second open inside the debounce
 * window changes nothing and costs one conditional statement.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** A document opened again inside this window is not recorded again. */
export const VIEW_DEBOUNCE_MS = 5 * 60 * 1000

/** How long a view is kept, and how far back "my places" and "jump back in" look. */
export const HISTORY_RETENTION_MS = 90 * DAY_MS

export interface DocumentViewDependencies {
  readonly uow: UnitOfWork
  readonly clock: Clock
}

export interface RecordDocumentViewCommand {
  readonly userId: UserId
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
}

/** Notes that the person opened the document; answers whether anything was written. */
export function recordDocumentView(
  deps: DocumentViewDependencies,
  command: RecordDocumentViewCommand,
): Promise<boolean> {
  const now = deps.clock.now()
  return deps.uow.repos.documentViews.touch({
    ...command,
    now,
    debounceBefore: new Date(now.getTime() - VIEW_DEBOUNCE_MS),
  })
}

/** Forgets everything the person has opened; answers how many rows went. */
export function clearDocumentHistory(
  deps: Pick<DocumentViewDependencies, 'uow'>,
  userId: UserId,
): Promise<number> {
  return deps.uow.repos.documentViews.deleteForUser(userId)
}

/** Removes every view older than the retention window, for the housekeeping job. */
export function sweepDocumentViews(
  deps: Pick<DocumentViewDependencies, 'uow'>,
  now: Date,
): Promise<number> {
  return deps.uow.repos.documentViews.deleteOlderThan(
    new Date(now.getTime() - HISTORY_RETENTION_MS),
  )
}
