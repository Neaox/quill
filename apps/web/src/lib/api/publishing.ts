import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { useApiClient } from './client-context.tsx'
import { toApiError } from './errors.ts'
import { queryKeys } from './query-keys.ts'
import type { MergeRequired, PublishedResult } from './types.ts'

/**
 * Publish and restore: the only two writes to the content store (ADR-015).
 *
 * Both answer `200 { kind: 'published' }` or `409 { kind: 'merge-required' }`,
 * and the 409 is **not** the platform's error envelope — it carries the
 * conflicting texts a person needs in order to decide. So it is returned as a
 * result rather than thrown: a merge is an outcome of publishing, not a
 * failure of the request. Every other status is still an `ApiError`.
 */
export type PublishOutcome = PublishedResult | MergeRequired

export interface PublishInput {
  readonly documentId: string
  /** The revision the draft was based on; `null` before the document's first publish. */
  readonly base: string | null
  readonly changeNote?: string
}

export interface RestoreInput {
  readonly documentId: string
  readonly revision: string
  readonly changeNote?: string
}

/**
 * A new revision exists, so everything derived from the head is stale: the
 * document row (its `headRevision` and `status`), the head-revision body, the
 * envelope's last-published block, and the revision list. Each is invalidated
 * by key rather than by a broad predicate, so nothing else in the cache is
 * disturbed.
 */
function invalidatePublished(queryClient: QueryClient, documentId: string): void {
  for (const queryKey of [
    queryKeys.document(documentId),
    queryKeys.rendered(documentId),
    queryKeys.envelope(documentId),
    queryKeys.history(documentId),
    queryKeys.draft(documentId),
  ]) {
    void queryClient.invalidateQueries({ queryKey })
  }
}

export function usePublishDocument() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ documentId, base, changeNote }: PublishInput): Promise<PublishOutcome> => {
      const { data, error, response } = await client.POST('/api/documents/{id}/publish', {
        params: { path: { id: documentId } },
        body: { base, ...(changeNote === undefined ? {} : { changeNote }) },
      })
      if (response.status === 409 && isMergeRequired(error)) return error
      if (!response.ok || data === undefined) throw toApiError(response.status, error)
      return data
    },
    onSuccess: (result, { documentId }) => {
      if (result.kind === 'published') invalidatePublished(queryClient, documentId)
    },
  })
}

export function useRestoreRevision() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      documentId,
      revision,
      changeNote,
    }: RestoreInput): Promise<PublishOutcome> => {
      const { data, error, response } = await client.POST('/api/documents/{id}/restore', {
        params: { path: { id: documentId } },
        body: { revision, ...(changeNote === undefined ? {} : { changeNote }) },
      })
      if (response.status === 409 && isMergeRequired(error)) return error
      if (!response.ok || data === undefined) throw toApiError(response.status, error)
      return data
    },
    onSuccess: (result, { documentId }) => {
      if (result.kind === 'published') invalidatePublished(queryClient, documentId)
    },
  })
}

/**
 * `openapi-fetch` puts a non-2xx body in `error`, typed as the union of every
 * declared failure. This narrows it to the merge case by the discriminant the
 * server sends, so a 409 that is *not* a merge (a proxy's own conflict page,
 * say) still becomes an `ApiError` rather than being read as conflicts.
 */
function isMergeRequired(error: unknown): error is MergeRequired {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { kind?: unknown }).kind === 'merge-required'
  )
}
