import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type { CollectionDto } from './types.ts'

/**
 * Collections are a permission scope, not a folder (ADR-012). Every write
 * here invalidates the workspace tree, which is the one route that lists
 * them in the order the navigation shows them
 * (`docs/architecture/api-contract-m2.md`).
 */
function useInvalidateWorkspace() {
  const queryClient = useQueryClient()
  return (workspaceId: string) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceTree(workspaceId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceDocuments(workspaceId) })
  }
}

export interface CreateCollectionInput {
  readonly workspaceId: string
  readonly name: string
}

/**
 * Creates a collection: `POST /workspaces/:id/collections`. A name whose slug
 * another collection already holds comes back as `409
 * collection_slug_taken`, which the dialog shows inline.
 */
export function useCreateCollection() {
  const client = useApiClient()
  const invalidate = useInvalidateWorkspace()
  return useMutation({
    mutationFn: ({ workspaceId, name }: CreateCollectionInput) =>
      request<CollectionDto>(
        client.POST('/api/workspaces/{id}/collections', {
          params: { path: { id: workspaceId } },
          body: { name },
        }),
      ),
    onSuccess: (collection) => {
      invalidate(collection.workspaceId)
    },
  })
}

export interface RenameCollectionInput {
  readonly collectionId: string
  readonly name: string
}

/**
 * Renames a collection: `PATCH /collections/:id`. The slug stays exactly as it
 * was — nothing addresses a collection by slug — so a rename can never break a
 * link or a published path.
 */
export function useRenameCollection() {
  const client = useApiClient()
  const invalidate = useInvalidateWorkspace()
  return useMutation({
    mutationFn: ({ collectionId, name }: RenameCollectionInput) =>
      request<CollectionDto>(
        client.PATCH('/api/collections/{id}', {
          params: { path: { id: collectionId } },
          body: { name },
        }),
      ),
    onSuccess: (collection) => {
      invalidate(collection.workspaceId)
    },
  })
}

export interface DeleteCollectionInput {
  readonly collectionId: string
  /** Known by the caller; the `204` carries no body to read it from. */
  readonly workspaceId: string
}

/**
 * Deletes an empty collection: `DELETE /collections/:id`, answering `204`.
 *
 * A collection that still holds documents is refused with `409
 * collection_not_empty` and `details.documents` — the number of documents
 * still in it — because `collection_id` is nullable and removing the row
 * would take every document it held out of the permission tree. The caller
 * moves or deletes them first, which is what `DeleteCollectionDialog` says
 * and offers.
 */
export function useDeleteCollection() {
  const client = useApiClient()
  const invalidate = useInvalidateWorkspace()
  return useMutation({
    mutationFn: ({ collectionId }: DeleteCollectionInput) =>
      request<void>(
        client.DELETE('/api/collections/{id}', { params: { path: { id: collectionId } } }),
      ),
    onSuccess: (_result, { workspaceId }) => {
      invalidate(workspaceId)
    },
  })
}

/** `409 collection_not_empty`'s `details.documents`: how many are still in it. */
export function readDocumentCount(details: unknown): number | undefined {
  if (typeof details !== 'object' || details === null) return undefined
  if (!('documents' in details)) return undefined
  const { documents } = details
  return typeof documents === 'number' ? documents : undefined
}
