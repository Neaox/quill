import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import type { ApiClient } from '@quill/api-client'

import { now } from '../time/clock.ts'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type {
  SourceFreshnessDto,
  SourcePreviewResponseDto,
  SourceSettingsBody,
  WorkspaceSourceDto,
} from './types.ts'

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
    queryFn: async (context: { readonly client: QueryClient }) => {
      const source = await request<WorkspaceSourceDto>(
        client.GET('/api/workspaces/{id}/source', { params: { path: { id: workspaceId } } }),
      )
      // A sync that landed since the last answer changed the workspace's
      // documents: the tree and the lists beside this page are asked again.
      const before = context.client.getQueryData<WorkspaceSourceDto>(
        queryKeys.workspaceSource(workspaceId),
      )
      const landed = source.sync?.lastSyncedRevision ?? null
      if (before !== undefined && (before.sync?.lastSyncedRevision ?? null) !== landed) {
        void context.client.invalidateQueries({ queryKey: queryKeys.workspaceTree(workspaceId) })
        void context.client.invalidateQueries({
          queryKey: queryKeys.workspaceDocuments(workspaceId),
        })
      }
      return source
    },
  }
}

/** How long after saving the settings a page waits for the sync that saving asked for. */
export const SAVED_SYNC_WAIT_MS = 2 * 60_000

/**
 * Whether the settings were saved after the last attempt to sync, recently
 * enough that the sync saving asked for is still on its way: the page says
 * it is syncing, and asks again until it has been attempted.
 */
export function awaitsSyncAfterSave(source: WorkspaceSourceDto, at: number): boolean {
  const saved = Date.parse(source.updatedAt)
  const attempted = source.sync === null ? null : Date.parse(source.sync.lastAttemptAt)
  return (attempted === null || saved > attempted) && at - saved < SAVED_SYNC_WAIT_MS
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
    refetchInterval: (query) => {
      const data = query.state.data
      const busy = data !== undefined && (data.syncing || awaitsSyncAfterSave(data, now()))
      return busy || options.awaiting === true ? SYNCING_REFRESH_MS : false
    },
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

/** What a preview reads: where the source is, and how its files are placed. */
export type SourceDraftBody = Pick<
  SourceSettingsBody,
  'remote' | 'branch' | 'credential' | 'collections' | 'manifestEntry' | 'manifestPath'
>

/**
 * A dry run of a source's settings: the server fetches the branch's head as a
 * sync would and answers what saving would place where, writing nothing. A
 * repository that does not answer is an answer (`outcome: 'unreadable'`);
 * settings it refuses are an `ApiError` naming the field.
 */
export function usePreviewSource(workspaceId: string) {
  const client = useApiClient()
  return useMutation({
    mutationFn: (body: SourceDraftBody) =>
      request<SourcePreviewResponseDto>(
        client.POST('/api/workspaces/{id}/source/preview', {
          params: { path: { id: workspaceId } },
          body,
        }),
      ),
  })
}

/**
 * Saves a source's settings, which asks for a sync in the same step. The
 * first save makes a native workspace read from the repository.
 */
export function useConfigureSource(workspaceId: string) {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: SourceSettingsBody) =>
      request<WorkspaceSourceDto>(
        client.PUT('/api/workspaces/{id}/source', {
          params: { path: { id: workspaceId } },
          body,
        }),
      ),
    onSuccess: async (source) => {
      queryClient.setQueryData(queryKeys.workspaceSource(workspaceId), source)
      // The workspace's origin, and with it its menu, its read-only state and
      // the routes it may open, may have changed. Awaited, so a navigation the
      // caller makes next is decided by the workspace as it now is.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaces(), refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceList() }),
      ])
    },
  })
}

/**
 * Disconnects the workspace from its repository (ADR-061, amendment of 11
 * November 2026): it becomes native and keeps everything; the source is kept
 * as a record. Instance administration, as connecting is.
 */
export function useDisconnectSource(workspaceId: string) {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      request<WorkspaceSourceDto>(
        client.POST('/api/workspaces/{id}/source/disconnect', {
          params: { path: { id: workspaceId } },
        }),
      ),
    onSuccess: async (source) => {
      queryClient.setQueryData(queryKeys.workspaceSource(workspaceId), source)
      // The workspace is native now: its menu, its read-only state and what it
      // may be asked change with it, so a navigation next sees it as it is.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaces(), refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceList() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.documents() }),
      ])
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
