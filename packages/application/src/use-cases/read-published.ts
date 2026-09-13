import type { DocumentId, RevisionId, WorkspaceId } from '@quill/domain'

import type { ContentStore, DocumentSource } from '../ports/content-store.ts'
import type { DocumentFormat } from '../ports/document-format.ts'
import type { UnitOfWork } from '../ports/persistence.ts'

/**
 * The published source of a document (ADR-015).
 *
 * Drafts are not in the content store, so a document that has never been
 * published has no source to read: that is a distinct answer from "no such
 * document", because the reader is being told to wait for a publish rather
 * than that they have the wrong address.
 */

export interface ReadPublishedDependencies {
  readonly uow: UnitOfWork
  readonly contentStore: ContentStore
  readonly format: DocumentFormat
}

export interface ReadPublishedCommand {
  readonly documentId: DocumentId
  /** Defaults to the workspace's current revision. */
  readonly revision?: RevisionId | undefined
}

export type ReadPublishedResult =
  | {
      readonly kind: 'found'
      readonly revision: RevisionId
      readonly markdown: string
      readonly frontMatter: Record<string, unknown>
      readonly title: string | undefined
      readonly path: string
    }
  | { readonly kind: 'unpublished'; readonly documentId: DocumentId }
  | { readonly kind: 'not-found'; readonly documentId: DocumentId }

/**
 * The published source at a revision, or null.
 *
 * A revision the caller names is checked against the document's own history
 * first, so a revision from another document — or one that never existed —
 * reads as "not published here" rather than reaching the content store and
 * failing there.
 */
export async function readSource(
  deps: ReadPublishedDependencies,
  workspaceId: WorkspaceId,
  command: ReadPublishedCommand,
): Promise<DocumentSource | null> {
  if (command.revision !== undefined) {
    const known = await deps.uow.repos.revisions.findForDocument(
      command.documentId,
      command.revision,
    )
    if (known === null) return null
  }
  return deps.contentStore.read(workspaceId, command.documentId, command.revision)
}

export async function readPublished(
  deps: ReadPublishedDependencies,
  command: ReadPublishedCommand,
): Promise<ReadPublishedResult> {
  const document = await deps.uow.repos.documents.findById(command.documentId)
  if (document === null) return { kind: 'not-found', documentId: command.documentId }

  const source = await readSource(deps, document.workspaceId, command)
  if (source === null) return { kind: 'unpublished', documentId: command.documentId }

  const { frontMatter, title } = deps.format.read(source.markdown)
  return {
    kind: 'found',
    revision: source.revision,
    markdown: source.markdown,
    frontMatter,
    title,
    path: source.path,
  }
}
