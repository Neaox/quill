import type { DocumentId, RevisionId } from '@quill/domain'

import type { MergeConflict } from '../ports/content-store.ts'
import type { SessionId } from '../ports/persistence.ts'
import type {
  LockLostOutcome,
  PublishAuthor,
  PublishDependencies,
  PublishedOutcome,
} from './publish-document.ts'
import { heldByAnother, recordPublish } from './publish-document.ts'

/**
 * Restore: a new revision equal to an older one (ADR-015).
 *
 * History is never rewritten and nothing is reverted in place. The old
 * content is read back and published again, so restoring is an ordinary
 * publish that happens to carry content the document held before, and the
 * step it undid stays visible in the history. The draft is moved onto the
 * restored content too: an author whose draft still held the content that was
 * undone would otherwise undo the restore again with their next publish.
 */

export interface RestoreRevisionCommand {
  readonly documentId: DocumentId
  readonly revision: RevisionId
  readonly changeNote?: string | undefined
  readonly author: PublishAuthor
  /** The session restoring, so the lock is re-validated as it is for any other write (ADR-021). */
  readonly sessionId: SessionId
}

export type RestoreRevisionResult =
  | PublishedOutcome
  | LockLostOutcome
  | {
      readonly kind: 'merge-required'
      readonly current: RevisionId
      readonly conflicts: readonly MergeConflict[]
    }
  | { readonly kind: 'not-found'; readonly documentId: DocumentId }
  | { readonly kind: 'revision-not-found'; readonly revision: RevisionId }

export async function restoreRevision(
  deps: PublishDependencies,
  command: RestoreRevisionCommand,
): Promise<RestoreRevisionResult> {
  const { repos } = deps.uow
  const document = await repos.documents.findById(command.documentId)
  if (document === null) return { kind: 'not-found', documentId: command.documentId }

  // A revision the caller names is checked against this document's own
  // history first: one from another document, or one that never existed, is a
  // bad request rather than a failed read (ADR-014's index is the record).
  const known = await repos.revisions.findForDocument(command.documentId, command.revision)
  if (known === null) return { kind: 'revision-not-found', revision: command.revision }

  const source = await deps.contentStore.read(
    document.workspaceId,
    command.documentId,
    command.revision,
  )
  if (source === null) return { kind: 'revision-not-found', revision: command.revision }

  // Checked before the content store is written to, as a publish is, so a
  // restore that cannot count never leaves a revision behind that Postgres
  // knows nothing about; `recordPublish` checks again inside its transaction,
  // where a takeover cannot interleave (ADR-021).
  const holder = await heldByAnother(repos, command.documentId, command.sessionId, deps.clock.now())
  if (holder !== null) return { kind: 'lock-lost', holder }

  const { title } = deps.format.read(source.markdown)
  const summary = `Restore ${title ?? document.title}`
  // The base is this document's recorded head: the revision the row the
  // transaction read was published at. If somebody publishes between that read
  // and this write, the store three-way merges against it exactly as it does
  // for an ordinary publish, and a real conflict comes back to be resolved.
  const result = await deps.contentStore.publish({
    workspaceId: document.workspaceId,
    changes: [
      { kind: 'write', documentId: document.id, path: document.path, markdown: source.markdown },
    ],
    author: { name: command.author.name, email: command.author.email },
    summary,
    base: document.headRevision,
    ...(command.changeNote === undefined ? {} : { changeNote: command.changeNote }),
  })

  if (result.kind === 'merge-required') {
    return { kind: 'merge-required', current: result.current, conflicts: result.conflicts }
  }

  const recorded = await recordPublish(deps, {
    document,
    revision: result.revision,
    title: title ?? document.title,
    summary,
    author: command.author,
    sessionId: command.sessionId,
    changeNote: command.changeNote ?? null,
    draftContent: deps.format.toDraft(source.markdown),
  })
  if (!recorded.ok) return { kind: 'lock-lost', holder: recorded.holder }

  return {
    kind: 'published',
    revision: result.revision,
    document: recorded.document,
    warnings: [],
    frontMatterIssues: [],
    incompleteRequiredSections: [],
  }
}
