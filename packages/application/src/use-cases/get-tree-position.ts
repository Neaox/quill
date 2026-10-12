import type { DocumentId } from '@quill/domain'

import type { CollectionId, UnitOfWork } from '../ports/persistence.ts'

/**
 * Where a document sits in the navigation tree, for a tree that opens a level at a time
 * (ADR-049): the collection it is in, the documents it nests under from the outside in so
 * they can be opened to show it, and how many documents are beneath it.
 *
 * Ids only: a title is not this question's to give, and the ancestors' own pages say
 * what each is called to a reader who may see it.
 */

export interface GetTreePositionDependencies {
  readonly uow: UnitOfWork
}

export type GetTreePositionResult =
  | {
      readonly kind: 'position'
      readonly collectionId: CollectionId | null
      /** Outermost first: the order they are opened in. */
      readonly ancestors: readonly DocumentId[]
      readonly childCount: number
    }
  | { readonly kind: 'not-found'; readonly documentId: DocumentId }

export async function getTreePosition(
  deps: GetTreePositionDependencies,
  documentId: DocumentId,
): Promise<GetTreePositionResult> {
  const { documents } = deps.uow.repos
  const document = await documents.findById(documentId)
  if (document === null) return { kind: 'not-found', documentId }
  const [chain, counts] = await Promise.all([
    documents.listAncestors(documentId),
    documents.countChildren([documentId]),
  ])
  return {
    kind: 'position',
    collectionId: document.collectionId,
    ancestors: chain
      .filter(({ id }) => id !== documentId)
      .map(({ id }) => id)
      .toReversed(),
    childCount: counts.get(documentId) ?? 0,
  }
}
