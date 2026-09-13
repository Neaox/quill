import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'

import type { ApiClient } from '@quill/api-client'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type { CreateDocumentResponse, DocumentDto, WorkspaceTreeResponse } from './types.ts'

/**
 * The flat document list for a workspace. Grouping by collection is a view
 * concern (`features/workspaces`); the nested shape the navigation draws
 * comes from `workspaceTreeQueryOptions` below instead.
 */
export function workspaceDocumentsQueryOptions(client: ApiClient, workspaceId: string) {
  return {
    queryKey: queryKeys.workspaceDocuments(workspaceId),
    queryFn: () =>
      request<readonly DocumentDto[]>(
        client.GET('/api/workspaces/{workspaceId}/documents', {
          params: { path: { workspaceId } },
        }),
      ),
  }
}

export function useDocuments(workspaceId: string | undefined) {
  const client = useApiClient()
  return useQuery({
    ...workspaceDocumentsQueryOptions(client, workspaceId ?? ''),
    enabled: workspaceId !== undefined,
  })
}

export function documentQueryOptions(client: ApiClient, documentId: string) {
  return {
    queryKey: queryKeys.document(documentId),
    queryFn: () =>
      request<DocumentDto>(
        client.GET('/api/documents/{id}', { params: { path: { id: documentId } } }),
      ),
  }
}

export function useDocument(documentId: string | undefined) {
  const client = useApiClient()
  return useQuery({
    ...documentQueryOptions(client, documentId ?? ''),
    enabled: documentId !== undefined,
  })
}

/**
 * The document a route's loader has already awaited and canonicalised.
 *
 * `useSuspenseQuery`, not `useQuery`: the reading route's loader resolved this
 * reference before the page was rendered, so `data` is present on the first
 * render and a pending branch here would be unreachable (ADR-013).
 */
export function useLoadedDocument(documentId: string) {
  const client = useApiClient()
  return useSuspenseQuery(documentQueryOptions(client, documentId))
}

export interface CreateDocumentInput {
  readonly workspaceId: string
  readonly title: string
  /** Required by the server: a document cannot be created without a collection to sit in. */
  readonly collectionId: string
  readonly parentId?: string
  readonly templateId?: string
  readonly answers?: Readonly<Record<string, unknown>>
}

/**
 * Creates a document (template choice arrives later per the task, though
 * the request already carries `templateId`/`answers` now that the server
 * accepts them, so nothing here needs to change when a template picker is
 * built). Returns the full creation envelope — `document`, its initial
 * `draft`, `requiredSections`, and `warnings` — because the server does.
 */
export function useCreateDocument() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ workspaceId, ...body }: CreateDocumentInput) =>
      request<CreateDocumentResponse>(
        client.POST('/api/workspaces/{workspaceId}/documents', {
          params: { path: { workspaceId } },
          body,
        }),
      ),
    onSuccess: (result) => {
      // Both views of a workspace's contents: the flat list the home page
      // groups, and the nested tree the sidebar draws. A create that
      // invalidated only one of them would put the document on one screen and
      // not the other.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workspaceDocuments(result.document.workspaceId),
      })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workspaceTree(result.document.workspaceId),
      })
    },
  })
}

export interface RenameDocumentInput {
  readonly documentId: string
  readonly title: string
}

/**
 * Renames a document: `PATCH /documents/:id` with just `title`
 * (`packages/api-client/src/schema.gen.d.ts`). The server writes the new
 * title into the document's front matter, not only the row, so this is the
 * one route that changes it — nothing here touches content directly.
 *
 * The response is the full updated `Document`, so the cache is seeded
 * straight from it rather than waiting on a refetch; the workspace's flat
 * document list (the tree's source, `features/workspaces/workspace-navigation.tsx`)
 * is invalidated because it carries its own copy of the title.
 */
export function useRenameDocument() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ documentId, title }: RenameDocumentInput) =>
      request<DocumentDto>(
        client.PATCH('/api/documents/{id}', {
          params: { path: { id: documentId } },
          body: { title },
        }),
      ),
    onSuccess: (document) => {
      queryClient.setQueryData(queryKeys.document(document.id), document)
      // Every spelling of this document's address, not only the id: the page
      // that is open was very likely fetched by its reference.
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents() })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workspaceDocuments(document.workspaceId),
      })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workspaceTree(document.workspaceId),
      })
    },
  })
}

export interface MoveDocumentInput {
  readonly documentId: string
  readonly collectionId: string
  /** `null` moves the document to the collection's top level. */
  readonly parentId: string | null
}

/**
 * Moves a document to a different collection and/or parent: `PATCH
 * /documents/:id` with `collectionId`/`parentId`. The server is gaining
 * validation that the destination is in the same workspace and collection and
 * that the caller holds `manage` there (403/422); this hook does not swallow
 * those, so `MoveDocumentDialog` can show the message inline.
 *
 * Both the flat document list and the nested workspace tree carry the moved
 * document's location, so both are invalidated; the document's own cache
 * entry is seeded from the response like a rename.
 */
export function useMoveDocument() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ documentId, collectionId, parentId }: MoveDocumentInput) =>
      request<DocumentDto>(
        client.PATCH('/api/documents/{id}', {
          params: { path: { id: documentId } },
          body: { collectionId, parentId },
        }),
      ),
    onSuccess: (document) => {
      queryClient.setQueryData(queryKeys.document(document.id), document)
      // Every spelling of this document's address, not only the id: the page
      // that is open was very likely fetched by its reference.
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents() })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workspaceDocuments(document.workspaceId),
      })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workspaceTree(document.workspaceId),
      })
    },
  })
}

/**
 * The workspace's collections and documents as a tree
 * (`docs/architecture/api-contract-m2.md`): the source of the navigation
 * sidebar, of every collection picker, and of the collections' order — the
 * server's order is the one the interface shows, so the tree, the pickers and
 * the workspace home can never disagree about it.
 */
export function workspaceTreeQueryOptions(client: ApiClient, workspaceId: string) {
  return {
    queryKey: queryKeys.workspaceTree(workspaceId),
    queryFn: () =>
      request<WorkspaceTreeResponse>(
        client.GET('/api/workspaces/{id}/tree', { params: { path: { id: workspaceId } } }),
      ),
  }
}

export function useWorkspaceTree(workspaceId: string | undefined) {
  const client = useApiClient()
  return useQuery({
    ...workspaceTreeQueryOptions(client, workspaceId ?? ''),
    // The sidebar is rendered once by the workspace layout and stays mounted
    // across every navigation inside the workspace (`docs/design/feedback.md`).
    // Keeping the previous workspace's tree on screen while the next one
    // arrives is what stops it blanking when the switcher changes workspace.
    placeholderData: keepPreviousData,
    enabled: workspaceId !== undefined,
  })
}

export interface DeleteDocumentInput {
  readonly documentId: string
  /** Known by the caller; the `204` carries no body to read it from. */
  readonly workspaceId: string
}

/**
 * Deletes a document: `DELETE /documents/:id`, answering `204`.
 *
 * `documents.parent_id` sets its children's parent to null rather than
 * deleting them, so a delete **lifts** any children to the top level of their
 * collection instead of taking them away — which is what the confirmation
 * dialog tells the person before they press it
 * (`packages/application/src/use-cases/update-document.ts`). There is no
 * restore route for a deleted document, so nothing here offers an undo.
 */
export function useDeleteDocument() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ documentId }: DeleteDocumentInput) =>
      request<void>(client.DELETE('/api/documents/{id}', { params: { path: { id: documentId } } })),
    onSuccess: (_result, { documentId, workspaceId }) => {
      queryClient.removeQueries({ queryKey: queryKeys.document(documentId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceDocuments(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceTree(workspaceId) })
    },
  })
}
