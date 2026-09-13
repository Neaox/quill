import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createHookWrapper } from './hook-wrapper.tsx'
import { useAcquireLock, useHeartbeatLock, useReleaseLock, useTakeoverLock } from './locks.ts'
import type { ApiError } from './errors.ts'
import { errorResponse, jsonResponse } from './testing.ts'

const holder = {
  documentId: 'doc-1',
  holderUserId: 'user-2',
  holderSessionId: 'session-2',
  acquiredAt: '2026-01-01T00:00:00.000Z',
  lastHeartbeatAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-01-01T00:01:00.000Z',
}

describe('lock mutations (ADR-021)', () => {
  it('acquires a lock', async () => {
    const wrapper = createHookWrapper({
      'POST /api/documents/{id}/lock/acquire': () => jsonResponse(200, { lock: holder }),
    })
    const { result } = renderHook(() => useAcquireLock(), { wrapper })
    result.current.mutate('doc-1')
    await waitFor(() => {
      expect(result.current.data).toEqual({ lock: holder })
    })
  })

  it('maps 409 held with the holder in details', async () => {
    const wrapper = createHookWrapper({
      'POST /api/documents/{id}/lock/acquire': () =>
        errorResponse(409, 'held', 'This document is locked by another editor', { holder }),
    })
    const { result } = renderHook(() => useAcquireLock(), { wrapper })
    result.current.mutate('doc-1')
    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    expect((result.current.error as ApiError).status).toBe(409)
    expect((result.current.error as ApiError).code).toBe('held')
  })

  it('heartbeats and returns the new expiry', async () => {
    const wrapper = createHookWrapper({
      'POST /api/documents/{id}/lock/heartbeat': () =>
        jsonResponse(200, { expiresAt: '2026-01-01T00:02:00.000Z' }),
    })
    const { result } = renderHook(() => useHeartbeatLock(), { wrapper })
    result.current.mutate('doc-1')
    await waitFor(() => {
      expect(result.current.data).toEqual({ expiresAt: '2026-01-01T00:02:00.000Z' })
    })
  })

  it('maps a lapsed heartbeat to 410 expired', async () => {
    const wrapper = createHookWrapper({
      'POST /api/documents/{id}/lock/heartbeat': () =>
        errorResponse(410, 'expired', 'Your lock expired', { holder }),
    })
    const { result } = renderHook(() => useHeartbeatLock(), { wrapper })
    result.current.mutate('doc-1')
    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    expect((result.current.error as ApiError).status).toBe(410)
  })

  it('releases unconditionally', async () => {
    const wrapper = createHookWrapper({
      'DELETE /api/documents/{id}/lock': () => new Response(null, { status: 204 }),
    })
    const { result } = renderHook(() => useReleaseLock(), { wrapper })
    result.current.mutate('doc-1')
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
  })

  it('takes over an active lock as a workspace admin', async () => {
    const wrapper = createHookWrapper({
      'POST /api/documents/{id}/lock/takeover': () => jsonResponse(200, { lock: holder }),
    })
    const { result } = renderHook(() => useTakeoverLock(), { wrapper })
    result.current.mutate('doc-1')
    await waitFor(() => {
      expect(result.current.data).toEqual({ lock: holder })
    })
  })

  it('forbids a takeover by a non-admin with 403', async () => {
    const wrapper = createHookWrapper({
      'POST /api/documents/{id}/lock/takeover': () =>
        errorResponse(403, 'forbidden', 'Workspace admin required to take over an active lock'),
    })
    const { result } = renderHook(() => useTakeoverLock(), { wrapper })
    result.current.mutate('doc-1')
    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    expect((result.current.error as ApiError).status).toBe(403)
  })
})
