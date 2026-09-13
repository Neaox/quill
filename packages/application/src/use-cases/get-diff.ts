import type { DocumentId, RevisionId } from '@quill/domain'

import type { ContentDiff, ContentStore } from '../ports/content-store.ts'
import type { UnitOfWork } from '../ports/persistence.ts'

/**
 * Compare two revisions of one document (ADR-015).
 *
 * The diff is of the Markdown source, produced by the content store, so the
 * compare view and a `git diff` of a synchronised repository agree.
 */

export interface DiffDependencies {
  readonly uow: UnitOfWork
  readonly contentStore: ContentStore
}

export interface GetDiffCommand {
  readonly documentId: DocumentId
  /** Null compares against nothing, which is how a document's first revision reads. */
  readonly from: RevisionId | null
  readonly to: RevisionId
}

export type GetDiffResult =
  | { readonly kind: 'diff'; readonly diff: ContentDiff }
  | { readonly kind: 'not-found'; readonly documentId: DocumentId }
  | { readonly kind: 'revision-not-found'; readonly revision: RevisionId }

export async function getDiff(
  deps: DiffDependencies,
  command: GetDiffCommand,
): Promise<GetDiffResult> {
  const document = await deps.uow.repos.documents.findById(command.documentId)
  if (document === null) return { kind: 'not-found', documentId: command.documentId }

  // Both ends are checked against this document's own history before the
  // content store is asked for them (ADR-014: the index is the record), and
  // they are checked together: one lookup waiting for the other is a round
  // trip nobody needs.
  const ends = [command.from, command.to].filter((revision) => revision !== null)
  const known = await Promise.all(
    ends.map(async (revision) => ({
      revision,
      found: await deps.uow.repos.revisions.findForDocument(command.documentId, revision),
    })),
  )
  const missing = known.find((end) => end.found === null)
  if (missing !== undefined) return { kind: 'revision-not-found', revision: missing.revision }

  return {
    kind: 'diff',
    diff: await deps.contentStore.diff(
      document.workspaceId,
      command.documentId,
      command.from,
      command.to,
    ),
  }
}
