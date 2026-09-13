import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createHookWrapper } from './hook-wrapper.tsx'
import type { ApiError } from './errors.ts'
import { errorResponse, jsonResponse } from './testing.ts'
import { useUnits } from './units.ts'

describe('useUnits', () => {
  it('lists top-level units when no parentId is given', async () => {
    const wrapper = createHookWrapper({
      'GET /api/units': () =>
        jsonResponse(200, [
          { id: 'unit-1', parentId: null, name: 'Acme', createdAt: '2026-01-01T00:00:00.000Z' },
        ]),
    })
    const { result } = renderHook(() => useUnits(), { wrapper })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data).toHaveLength(1)
  })

  it('lists children of a given parentId', async () => {
    const wrapper = createHookWrapper({
      'GET /api/units': (request) => {
        const url = new URL(request.url)
        expect(url.searchParams.get('parentId')).toBe('unit-1')
        return jsonResponse(200, [])
      },
    })
    const { result } = renderHook(() => useUnits('unit-1'), { wrapper })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
  })

  it('settles into an error state for a non-admin (403 forbidden)', async () => {
    const wrapper = createHookWrapper({
      'GET /api/units': () => errorResponse(403, 'forbidden', 'Instance admin required'),
    })
    const { result } = renderHook(() => useUnits(), { wrapper })
    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    expect((result.current.error as ApiError).status).toBe(403)
  })
})
