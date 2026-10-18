import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { ApiClient } from '@quill/api-client'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type { HomeSummaryDto } from './types.ts'

/** Whose changes the feed shows: the places the person works in, or every place they can see. */
export type HomeScope = 'mine' | 'everywhere'

/**
 * What the signed-in home shows: per-workspace counts, the newest drafts and
 * the newest published changes (`GET /api/home`).
 *
 * One bounded request in place of a document list per workspace, so the page
 * costs the same for a team and for an organisation with hundreds of
 * workspaces (AGENTS.md rule 13). Without a `scope` the server chooses: the
 * person's own places when they have any history, everywhere when they have not.
 */
export function homeSummaryQueryOptions(client: ApiClient, scope?: HomeScope) {
  return {
    queryKey: queryKeys.home(scope),
    queryFn: () =>
      request<HomeSummaryDto>(
        client.GET('/api/home', scope === undefined ? {} : { params: { query: { scope } } }),
      ),
  }
}

export function useHomeSummary(scope?: HomeScope) {
  const client = useApiClient()
  // Switching scope keeps what was on the page until the answer arrives, so the feed does not
  // blink out and back for a choice the person made.
  return useQuery({ ...homeSummaryQueryOptions(client, scope), placeholderData: keepPreviousData })
}

/**
 * Tells the server a document was opened, for the person's own "Jump back in" and for
 * ordering their workspaces (ADR-053). The record is theirs alone; the server ignores a repeat
 * within minutes, so calling this on every visit costs nothing.
 */
export function useRecordView() {
  const client = useApiClient()
  return useMutation({
    mutationFn: (documentId: string) =>
      request<void>(
        client.POST('/api/documents/{id}/view', { params: { path: { id: documentId } } }),
      ),
  })
}

/** Forgets what the person has opened, which the home page then stops using. */
export function useClearViewingHistory() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => request<void>(client.DELETE('/api/me/history')),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.homeAll() })
    },
  })
}
