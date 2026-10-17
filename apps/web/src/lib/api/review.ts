import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type { AttentionItem, ReviewerCandidates, ReviewRequestDto } from './types.ts'

/**
 * Review requests (ADR-052): asking named people and groups to look at a draft
 * before it goes live, and answering such a request.
 *
 * A document has one open request at a time, so the cache holds one entry per
 * document and every write **replaces it with what the server answered**
 * rather than patching it: who has answered, whether the draft has moved on
 * since, and what the overall status is are the server's to say.
 */

export type ReviewDecision = 'approve' | 'request_changes'

/** Somebody to ask: a person or a group, by id. */
export interface ReviewerRef {
  readonly kind: 'user' | 'group'
  readonly id: string
}

/**
 * The document's review request, if it has one. Asked for by anybody who can
 * edit the document or has been asked to review it; the server answers a
 * `403` to everyone else, so a screen asks only where it can expect an answer.
 */
export function useReview(documentId: string, options: { readonly enabled?: boolean } = {}) {
  const client = useApiClient()
  return useQuery({
    queryKey: queryKeys.review(documentId),
    queryFn: async () =>
      (
        await request<{ readonly request: ReviewRequestDto | null }>(
          client.GET('/api/documents/{id}/review', { params: { path: { id: documentId } } }),
        )
      ).request,
    enabled: options.enabled ?? true,
  })
}

/**
 * The people and groups who could be asked, for what has been typed. Only
 * the server knows who can see this document, so the list is never filtered
 * here. Nothing is asked until something is typed or the picker is opened.
 */
export function useReviewerCandidates(
  documentId: string,
  query: string,
  options: { readonly enabled?: boolean } = {},
) {
  const client = useApiClient()
  return useQuery({
    queryKey: queryKeys.reviewerCandidates(documentId, query),
    queryFn: () =>
      request<ReviewerCandidates>(
        client.GET('/api/documents/{id}/reviewer-candidates', {
          params: { path: { id: documentId }, query: { q: query } },
        }),
      ),
    enabled: options.enabled ?? true,
    // A directory moves slowly and a picker is typed into quickly.
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  })
}

function useReplaceReview(documentId: string) {
  const queryClient = useQueryClient()
  return (review: ReviewRequestDto | null) => {
    queryClient.setQueryData(queryKeys.review(documentId), review)
    // What is waiting on people has changed with it.
    void queryClient.invalidateQueries({ queryKey: queryKeys.attention() })
  }
}

export interface RequestReviewInput {
  readonly reviewers: readonly ReviewerRef[]
  readonly message?: string | undefined
}

/** Asks for a review. A request already open is replaced by this one. */
export function useRequestReview(documentId: string) {
  const client = useApiClient()
  const replace = useReplaceReview(documentId)
  return useMutation({
    mutationFn: ({ reviewers, message }: RequestReviewInput) =>
      request<ReviewRequestDto>(
        client.POST('/api/documents/{id}/review', {
          params: { path: { id: documentId } },
          body: {
            reviewers: [...reviewers],
            ...(message === undefined || message.trim() === '' ? {} : { message: message.trim() }),
          },
        }),
      ),
    onSuccess: replace,
  })
}

export interface DecideReviewInput {
  readonly decision: ReviewDecision
  readonly comment?: string | undefined
}

/** Answers a request that was addressed to the signed-in person or to a group they are in. */
export function useDecideReview(documentId: string) {
  const client = useApiClient()
  const replace = useReplaceReview(documentId)
  return useMutation({
    mutationFn: ({ decision, comment }: DecideReviewInput) =>
      request<ReviewRequestDto>(
        client.POST('/api/documents/{id}/review/decision', {
          params: { path: { id: documentId } },
          body: {
            decision,
            ...(comment === undefined || comment.trim() === '' ? {} : { comment: comment.trim() }),
          },
        }),
      ),
    onSuccess: replace,
  })
}

/** Takes the open request back. */
export function useWithdrawReview(documentId: string) {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      request<void>(
        client.DELETE('/api/documents/{id}/review', { params: { path: { id: documentId } } }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.review(documentId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.attention() })
    },
  })
}

/**
 * What is waiting on the signed-in person: review requests addressed to them
 * or a group of theirs, and the answers to requests they made. It asks again
 * whenever the home page opens (`staleTime` is zero).
 */
export function useAttention() {
  const client = useApiClient()
  return useQuery({
    queryKey: queryKeys.attention(),
    queryFn: async () =>
      (await request<{ readonly items: readonly AttentionItem[] }>(client.GET('/api/me/attention')))
        .items,
  })
}
