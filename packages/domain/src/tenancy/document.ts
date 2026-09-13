import type { DocumentStatus } from '../document-status.ts'
import type { CollectionId, DocumentId, WorkspaceId } from '../ids.ts'

/**
 * A page of documentation, nested below a collection.
 *
 * A document belongs to exactly one place in the tree, and `workspaceId` and
 * `collectionId` are carried on the record so that permission resolution and
 * list views never have to walk the document's ancestors to find its scope.
 */
export interface Document {
  readonly id: DocumentId
  readonly workspaceId: WorkspaceId
  readonly collectionId: CollectionId

  /** The document this one nests under, or null when it sits at the top of its collection. */
  readonly parentId: DocumentId | null

  readonly slug: string
  readonly title: string
  readonly status: DocumentStatus
}
