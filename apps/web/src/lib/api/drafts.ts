import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { ApiClient } from '@quill/api-client'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type { DocumentEnvelope, DraftDto, PutBackResponse, SaveDraftResponse } from './types.ts'

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
    // The open editor owns the draft's content, and a refetched draft never
    // replaces it; refetching on focus only added chances for a transient
    // failure while somebody was writing (audit 2026-10-11, P0-2).
    refetchOnWindowFocus: false,
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
    onSuccess: (result, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.draft(variables.documentId) })
      // A saved draft is ahead of what was published, which the header says
      // ("Published, with unpublished changes") and the notice above the page
      // dates. Known here without asking: the envelope is set rather than
      // fetched again on every autosave.
      queryClient.setQueryData<DocumentEnvelope>(
        queryKeys.envelope(variables.documentId),
        (envelope) =>
          envelope === undefined
            ? envelope
            : {
                ...envelope,
                unpublishedChanges: envelope.lastPublished !== null,
                draft: { savedAt: result.updatedAt },
              },
      )
    },
  })
}

export interface PutBackInput {
  readonly documentId: string
  /** The revision the changes are since: the published page; null before the first publish. */
  readonly from: string | null
  /** The version of the draft that was compared. */
  readonly draftVersion: number
  /** The changes, by the ids the comparison gave them. */
  readonly changes: readonly string[]
}

export interface UndoPutBackInput {
  readonly documentId: string
  /** The version the put back made. */
  readonly draftVersion: number
  /** What the draft held before, as the put back handed it back. */
  readonly ast: Record<string, unknown>
}

/**
 * Everything that reads the draft is out of date once a change is put back in it from
 * outside the editor: the draft, the envelope that dates it, and every comparison with it.
 */
function forgetDraft(queryClient: ReturnType<typeof useQueryClient>, documentId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.draft(documentId) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.envelope(documentId) })
  void queryClient.invalidateQueries({ queryKey: ['comparison', documentId] })
  void queryClient.invalidateQueries({ queryKey: ['comparison-source', documentId] })
}

/**
 * `POST /documents/:id/draft/revert`: changes since the published page put back in the
 * draft and saved, from the comparison page. Refused with `423 lock_lost` while somebody
 * else is editing, and `409 stale_version` when the draft is no longer the one compared.
 */
export function usePutBackChanges() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ documentId, from, draftVersion, changes }: PutBackInput) =>
      request<PutBackResponse>(
        client.POST('/api/documents/{id}/draft/revert', {
          params: { path: { id: documentId } },
          body: { draftVersion, changes: [...changes], ...(from === null ? {} : { from }) },
        }),
      ),
    onSuccess: (_result, { documentId }) => {
      forgetDraft(queryClient, documentId)
    },
  })
}

/** `POST /documents/:id/draft/revert/undo`: a put back undone, with what it handed back. */
export function useUndoPutBack() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ documentId, draftVersion, ast }: UndoPutBackInput) =>
      request<{ readonly draftVersion: number }>(
        client.POST('/api/documents/{id}/draft/revert/undo', {
          params: { path: { id: documentId } },
          body: { draftVersion, ast },
        }),
      ),
    onSuccess: (_result, { documentId }) => {
      forgetDraft(queryClient, documentId)
    },
  })
}

/**
 * The draft as it would be with some changes put back (`POST /documents/:id/draft/revert-preview`).
 *
 * Not a write: an open editor applies the answer as an edit of its own, so it can be undone
 * and is saved the way anything typed is. A `409` means the draft moved on under the person
 * looking at it.
 */
export function useRevertPreview() {
  const client = useApiClient()
  return useMutation({
    mutationFn: ({ documentId, from, draftVersion, changes }: PutBackInput) =>
      request<{ readonly draftVersion: number; readonly ast: Record<string, unknown> }>(
        client.POST('/api/documents/{id}/draft/revert-preview', {
          params: { path: { id: documentId } },
          body: { draftVersion, changes: [...changes], ...(from === null ? {} : { from }) },
        }),
      ),
  })
}
