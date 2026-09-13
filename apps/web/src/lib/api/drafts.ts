import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { ApiClient } from '@quill/api-client'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type { DraftDto, SaveDraftResponse } from './types.ts'

/**
 * Shared by the hook below and by the editor's `DraftClient.load`
 * (`editor-clients.ts`), which re-reads a draft through
 * `queryClient.fetchQuery` after a stale-version conflict. Declaring the
 * options once is what keeps that re-read and this hook on the same cache
 * entry instead of two that drift.
 */
export function draftQueryOptions(client: ApiClient, documentId: string) {
  return {
    queryKey: queryKeys.draft(documentId),
    queryFn: () =>
      request<DraftDto>(
        client.GET('/api/documents/{id}/draft', { params: { path: { id: documentId } } }),
      ),
  }
}

export function useDraft(documentId: string | undefined) {
  const client = useApiClient()
  return useQuery({
    ...draftQueryOptions(client, documentId ?? ''),
    enabled: documentId !== undefined,
  })
}

export interface SaveDraftInput {
  readonly documentId: string
  readonly ast: unknown
  readonly expectedVersion: number
}

/**
 * `PUT /documents/:id/draft`, mapped to `ApiError` exactly per the ADR-021
 * contract table: `423 lock_lost` (the caller does not hold a valid lock and
 * must stop autosave and enter recovery), `409 stale_version` (the caller
 * holds the lock but its version is behind and must re-read and retry), and
 * `401 session_expired`. Callers branch on `error.status`/`error.code`; see
 * `drafts.test.ts` for the exact mapping.
 */
export function useSaveDraft() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ documentId, ast, expectedVersion }: SaveDraftInput) =>
      request<SaveDraftResponse>(
        client.PUT('/api/documents/{id}/draft', {
          params: { path: { id: documentId } },
          body: { ast, expectedVersion },
        }),
      ),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.draft(variables.documentId) })
    },
  })
}
