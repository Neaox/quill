import type { DocumentId } from '@quill/domain'

import type { ContentStore } from '../ports/content-store.ts'
import type { DocumentFormat } from '../ports/document-format.ts'
import type { DraftRow, UnitOfWork } from '../ports/persistence.ts'
import type { Clock } from '../ports/system.ts'

/**
 * The draft an editor opens.
 *
 * Every document the application creates gets its draft in the same
 * transaction (`createDocument`), but not every document was created that
 * way: an import, a seed, or a row written before drafts existed has none.
 * Opening the editor on one is not an error: the draft starts from the
 * published revision when there is one — what a reader sees is what the
 * author carries on from — and from a blank document named by its title when
 * there is not.
 */

export interface OpenDraftDependencies {
  readonly uow: UnitOfWork
  readonly contentStore: ContentStore
  readonly format: DocumentFormat
  readonly clock: Clock
}

export type OpenDraftResult =
  | { readonly kind: 'draft'; readonly draft: DraftRow }
  | { readonly kind: 'not-found' }

export async function openDraft(
  deps: OpenDraftDependencies,
  documentId: DocumentId,
): Promise<OpenDraftResult> {
  const { repos } = deps.uow
  const existing = await repos.drafts.find(documentId)
  if (existing !== null) return { kind: 'draft', draft: existing }

  const document = await repos.documents.findById(documentId)
  if (document === null) return { kind: 'not-found' }

  const head = document.headRevision
  const published =
    head === null ? null : await deps.contentStore.read(document.workspaceId, documentId, head)
  const draft = await repos.drafts.init({
    documentId,
    baseRevision: published === null ? null : head,
    ast:
      published === null
        ? deps.format.create({ documentId, title: document.title }).content
        : deps.format.toDraft(published.markdown),
    now: deps.clock.now(),
  })
  return { kind: 'draft', draft }
}
