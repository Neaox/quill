import { useQuery } from '@tanstack/react-query'

import type { ApiClient } from '@quill/api-client'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type { CollectionDto, TreeChildrenPage, TreePosition } from './types.ts'

/**
 * The navigation tree, a level at a time (ADR-049).
 *
 * The sidebar does not ask for the workspace's whole tree: it asks for the collections, and for
 * one page of one parent's children when that parent is opened, so what it fetches and what it
 * draws are the rows a reader is looking at and never the size of the workspace.
 */

/** A page is this many documents; "Show more" asks for the next. */
export const TREE_PAGE_SIZE = 50

/** A page is as fresh as the documents under it are likely to have been changed, which is not often. */
const PAGE_STALE_MS = 30_000

/** The workspace's collections, by name: the sections of the tree. */
export function treeCollectionsQueryOptions(client: ApiClient, workspaceId: string) {
  return {
    queryKey: queryKeys.treeCollections(workspaceId),
    queryFn: () =>
      request<readonly CollectionDto[]>(
        client.GET('/api/workspaces/{id}/collections', { params: { path: { id: workspaceId } } }),
      ),
    staleTime: PAGE_STALE_MS,
  }
}

export function useTreeCollections(workspaceId: string | undefined) {
  const client = useApiClient()
  return useQuery({
    ...treeCollectionsQueryOptions(client, workspaceId ?? ''),
    enabled: workspaceId !== undefined,
  })
}

export interface TreeLevel {
  readonly collectionId: string
  /** The parent, or null for the top of the collection. */
  readonly parentId: string | null
}

/** One page of one level; `cursor` is the `next` of the page before it, null for the first. */
export function treeChildrenQueryOptions(
  client: ApiClient,
  workspaceId: string,
  level: TreeLevel,
  cursor: string | null,
) {
  return {
    queryKey: queryKeys.treeChildren(workspaceId, level.collectionId, level.parentId, cursor),
    queryFn: () =>
      request<TreeChildrenPage>(
        client.GET('/api/workspaces/{id}/tree/children', {
          params: {
            path: { id: workspaceId },
            query: {
              collectionId: level.collectionId,
              ...(level.parentId === null ? {} : { parentId: level.parentId }),
              ...(cursor === null ? {} : { cursor }),
              limit: TREE_PAGE_SIZE,
            },
          },
        }),
      ),
    staleTime: PAGE_STALE_MS,
  }
}

/** Where a document is in the tree: what is opened to show it, and how many are under it. */
export function useTreePosition(documentId: string | undefined) {
  const client = useApiClient()
  return useQuery({
    queryKey: queryKeys.treePosition(documentId ?? ''),
    queryFn: () =>
      request<TreePosition>(
        client.GET('/api/documents/{id}/tree-position', {
          params: { path: { id: documentId ?? '' } },
        }),
      ),
    enabled: documentId !== undefined,
    staleTime: PAGE_STALE_MS,
  })
}
