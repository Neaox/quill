import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { ApiClient } from '@quill/api-client'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type { SourceFreshnessDto, WorkspaceSourceDto } from './types.ts'

/**
 * A sourced workspace's repository (ADR-061): its settings and sync state for
 * the source's page, "Sync now", and the reader's question "has this page
 * moved on?".
 */

/** How often the source's page asks again while a sync is under way. */
const SYNCING_REFRESH_MS = 3_000

/** How often an open sourced document asks whether it has moved on. */
export const SOURCE_FRESHNESS_REFRESH_MS = 15_000

export function workspaceSourceQueryOptions(client: ApiClient, workspaceId: string) {
  return {
    queryKey: queryKeys.workspaceSource(workspaceId),
    queryFn: () =>
      request<WorkspaceSourceDto>(
        client.GET('/api/workspaces/{id}/source', { params: { path: { id: workspaceId } } }),
      ),
  }
}

/**
 * The source and how far it has synced. While a sync runs — or one was just
 * asked for and has not been attempted yet — it asks again every few seconds,
 * so the page moves from "syncing" to the outcome without a reload.
 */
export function useWorkspaceSource(workspaceId: string, options: { awaiting?: boolean } = {}) {
  const client = useApiClient()
  return useQuery({
    ...workspaceSourceQueryOptions(client, workspaceId),
    refetchInterval: (query) =>
      query.state.data?.syncing === true || options.awaiting === true ? SYNCING_REFRESH_MS : false,
  })
}

/** "Sync now": asks for a sync, which runs off the request on the job runner. */
export function useSyncSourceNow(workspaceId: string) {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      request<{ requested: boolean }>(
        client.POST('/api/workspaces/{id}/source/sync', { params: { path: { id: workspaceId } } }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceSource(workspaceId) })
    },
  })
}

/**
 * Whether an open document read from a repository has moved on. Asking is
 * also what starts the check on read on the server. It asks again while the
 * tab is in front, and not at all for a document that is not sourced.
 */
export function useSourceFreshness(documentId: string, enabled: boolean) {
  const client = useApiClient()
  return useQuery({
    queryKey: queryKeys.sourceFreshness(documentId),
    queryFn: () =>
      request<SourceFreshnessDto>(
        client.GET('/api/documents/{id}/source-freshness', {
          params: { path: { id: documentId } },
        }),
      ),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.sourced === false ? false : SOURCE_FRESHNESS_REFRESH_MS,
  })
}
