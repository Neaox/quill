import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type { AcquireLockResponse, HeartbeatResponse, TakeoverResponse } from './types.ts'

/**
 * Lock acquire, heartbeat, release, and admin takeover, exactly per the
 * ADR-021 API contract table. Every mutation here can fail with a distinct
 * status the caller is expected to branch on without parsing the body
 * (`409 held`, `410 expired`, `409 taken_over`, `404 released`, `403` on a
 * non-admin takeover): `ApiError.status`/`.code` carry that, via `request`.
 */
export function useAcquireLock() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (documentId: string) =>
      request<AcquireLockResponse>(
        client.POST('/api/documents/{id}/lock/acquire', { params: { path: { id: documentId } } }),
      ),
    onSuccess: (_result, documentId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.lock(documentId) })
    },
  })
}

export function useHeartbeatLock() {
  const client = useApiClient()
  return useMutation({
    mutationFn: (documentId: string) =>
      request<HeartbeatResponse>(
        client.POST('/api/documents/{id}/lock/heartbeat', { params: { path: { id: documentId } } }),
      ),
  })
}

/** Release is unconditional and idempotent on the server; it always resolves. */
export function useReleaseLock() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (documentId: string) =>
      request<void>(
        client.DELETE('/api/documents/{id}/lock', { params: { path: { id: documentId } } }),
      ),
    onSuccess: (_result, documentId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.lock(documentId) })
    },
  })
}

/** Workspace-admin only on the server; a non-admin's mutation rejects with `403`. */
export function useTakeoverLock() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (documentId: string) =>
      request<TakeoverResponse>(
        client.POST('/api/documents/{id}/lock/takeover', { params: { path: { id: documentId } } }),
      ),
    onSuccess: (_result, documentId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.lock(documentId) })
    },
  })
}
