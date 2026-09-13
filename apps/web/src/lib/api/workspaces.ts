import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'

import type { ApiClient } from '@quill/api-client'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type { WorkspaceDto, WorkspaceSummaryDto } from './types.ts'

/**
 * A single workspace, by **either** spelling of its address: `GET
 * /api/workspaces/{idOrSlug}` resolves a slug as readily as a UUID (ADR-035;
 * `apps/server/src/routes/workspaces.ts`'s `resolveWorkspaceId`).
 *
 * That is also why the key is the spelling that asked. The layout route's
 * loader resolves the URL segment once and seeds the answer under the
 * workspace's **id** as well, and everything below it — the tree, the document
 * list, an invalidation after a write — is keyed by that id, so two spellings
 * of one workspace can never become two live entries.
 */
export function workspaceQueryOptions(client: ApiClient, idOrSlug: string) {
  return {
    queryKey: queryKeys.workspace(idOrSlug),
    queryFn: () =>
      request<WorkspaceDto>(
        client.GET('/api/workspaces/{id}', { params: { path: { id: idOrSlug } } }),
      ),
  }
}

export function useWorkspace(idOrSlug: string | undefined) {
  const client = useApiClient()
  return useQuery({
    ...workspaceQueryOptions(client, idOrSlug ?? ''),
    enabled: idOrSlug !== undefined,
  })
}

/**
 * The workspace a route's loader has already awaited.
 *
 * `useSuspenseQuery`, not `useQuery`: the loader put this entry in the cache
 * before the component was rendered, so `data` is present on the first render
 * and a pending branch here would be unreachable code pretending to be a
 * state (ADR-013 — the loader and the component share one options factory, so
 * they share one entry).
 */
export function useLoadedWorkspace(idOrSlug: string) {
  const client = useApiClient()
  return useSuspenseQuery(workspaceQueryOptions(client, idOrSlug))
}

/**
 * Every workspace the signed-in person can see (`GET /api/workspaces`), with
 * its unit. Shared between the home route's `beforeLoad` (which runs outside
 * React and so needs the options, not a hook) and the components that list
 * workspaces — the home page, the switcher, the admin surface — so all of
 * them read one cache entry.
 */
export function workspaceListQueryOptions(client: ApiClient) {
  return {
    queryKey: queryKeys.workspaceList(),
    queryFn: () => request<readonly WorkspaceSummaryDto[]>(client.GET('/api/workspaces')),
  }
}

export function useWorkspaceList() {
  const client = useApiClient()
  return useQuery(workspaceListQueryOptions(client))
}

function useInvalidateWorkspaces() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceList() })
  }
}

export interface CreateWorkspaceInput {
  readonly unitId: string
  readonly name: string
  /** Unique across the instance: it is what a published site will be addressed by. */
  readonly slug: string
}

/**
 * Creates a workspace: `POST /api/workspaces` (instance administration,
 * because it attaches a body of documentation to a unit). A slug another
 * workspace already holds comes back as `409 workspace_slug_taken`, which the
 * dialog shows against the slug field rather than swallowing.
 */
export function useCreateWorkspace() {
  const client = useApiClient()
  const invalidate = useInvalidateWorkspaces()
  return useMutation({
    mutationFn: (body: CreateWorkspaceInput) =>
      request<WorkspaceDto>(client.POST('/api/workspaces', { body })),
    onSuccess: invalidate,
  })
}

export interface RenameWorkspaceInput {
  readonly workspaceId: string
  readonly name: string
}

export function useRenameWorkspace() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ workspaceId, name }: RenameWorkspaceInput) =>
      request<WorkspaceDto>(
        client.PATCH('/api/workspaces/{id}', {
          params: { path: { id: workspaceId } },
          body: { name },
        }),
      ),
    onSuccess: (workspace) => {
      // Both spellings of this workspace's address (ADR-035): the id every
      // component is keyed by, and the slug a loader looked it up with. Seeding
      // only one of them would leave a freshly entered URL showing the name
      // this rename just replaced.
      queryClient.setQueryData(queryKeys.workspace(workspace.id), workspace)
      queryClient.setQueryData(queryKeys.workspace(workspace.slug), workspace)
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceList() })
    },
  })
}

/**
 * Deletes a workspace: `DELETE /api/workspaces/:id`, answering `204`.
 *
 * The server does **not** refuse a workspace that still holds documents — the
 * row cascades to its collections, documents, drafts and revisions index — so
 * the interface is what keeps "delete an empty one" true: `DeleteWorkspaceDialog`
 * counts the documents first and offers the button only when there are none.
 */
export function useDeleteWorkspace() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (workspaceId: string) =>
      request<void>(
        client.DELETE('/api/workspaces/{id}', { params: { path: { id: workspaceId } } }),
      ),
    onSuccess: (_result, workspaceId) => {
      queryClient.removeQueries({ queryKey: queryKeys.workspace(workspaceId) })
      // The slug spelling too: nothing should resolve a workspace that is gone.
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceList() })
    },
  })
}
