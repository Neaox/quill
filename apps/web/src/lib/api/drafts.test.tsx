import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { ApiClientProvider } from './client-context.tsx'
import { useSaveDraft } from './drafts.ts'
import { ApiError } from './errors.ts'
import { createFakeApiClient, errorResponse, jsonResponse } from './testing.ts'

function wrapperWithRoutes(routes: Parameters<typeof createFakeApiClient>[0]) {
  const client = createFakeApiClient(routes)
  const queryClient = new QueryClient()
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <ApiClientProvider client={client}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiClientProvider>
    )
  }
}

/**
 * ADR-021's draft write contract, exactly: `423 lock_lost`, `409
 * stale_version`, `401 session_expired`. `useSaveDraft` (`drafts.ts`) is a
 * thin wrapper over `request` (`http.ts`); what is under test is that the
 * server's status code and error code both survive onto the thrown
 * `ApiError` unchanged, since every caller branches on exactly those two
 * fields rather than re-parsing the response body.
 */
describe('useSaveDraft status-code mapping (ADR-021)', () => {
  it('maps a successful write to the new draft version', async () => {
    const wrapper = wrapperWithRoutes({
      'PUT /api/documents/{id}/draft': () =>
        jsonResponse(200, { draftVersion: 4, updatedAt: '2026-09-12T00:00:00.000Z' }),
    })
    const { result } = renderHook(() => useSaveDraft(), { wrapper })

    result.current.mutate({ documentId: 'doc-1', ast: {}, expectedVersion: 3 })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data).toEqual({ draftVersion: 4, updatedAt: '2026-09-12T00:00:00.000Z' })
  })

  it('maps 423 to a lock_lost ApiError with the holder in details', async () => {
    const holder = { documentId: 'doc-1', holderUserId: 'u-2', holderSessionId: 's-2' }
    const wrapper = wrapperWithRoutes({
      'PUT /api/documents/{id}/draft': () =>
        errorResponse(423, 'lock_lost', 'You do not hold a valid lock on this document', {
          holder,
        }),
    })
    const { result } = renderHook(() => useSaveDraft(), { wrapper })

    result.current.mutate({ documentId: 'doc-1', ast: {}, expectedVersion: 3 })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    const error = result.current.error
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(423)
    expect((error as ApiError).code).toBe('lock_lost')
    expect((error as ApiError).details).toEqual({ holder })
  })

  it('maps 409 to a stale_version ApiError with the current version in details', async () => {
    const wrapper = wrapperWithRoutes({
      'PUT /api/documents/{id}/draft': () =>
        errorResponse(409, 'stale_version', 'Your draft version is behind the current one', {
          currentVersion: 7,
        }),
    })
    const { result } = renderHook(() => useSaveDraft(), { wrapper })

    result.current.mutate({ documentId: 'doc-1', ast: {}, expectedVersion: 3 })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    const error = result.current.error
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(409)
    expect((error as ApiError).code).toBe('stale_version')
    expect((error as ApiError).details).toEqual({ currentVersion: 7 })
  })

  it('maps 401 to a session_expired ApiError', async () => {
    const wrapper = wrapperWithRoutes({
      'PUT /api/documents/{id}/draft': () =>
        errorResponse(401, 'session_expired', 'Your session has expired, please sign in again'),
    })
    const { result } = renderHook(() => useSaveDraft(), { wrapper })

    result.current.mutate({ documentId: 'doc-1', ast: {}, expectedVersion: 3 })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    const error = result.current.error
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(401)
    expect((error as ApiError).code).toBe('session_expired')
  })
})
