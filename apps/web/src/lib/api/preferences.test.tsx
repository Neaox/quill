import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createHookWrapper } from './hook-wrapper.tsx'
import { usePersonPreferences, useSavePersonPreferences } from './preferences.ts'
import { jsonResponse } from './testing.ts'

describe('usePersonPreferences', () => {
  it('reads the signed-in person’s effective preferences', async () => {
    const wrapper = createHookWrapper({
      'GET /api/me/preferences': () => jsonResponse(200, { animatedImages: 'hover' }),
    })
    const { result } = renderHook(() => usePersonPreferences(), { wrapper })
    await waitFor(() => {
      expect(result.current.data).toEqual({ animatedImages: 'hover' })
    })
  })
})

describe('useSavePersonPreferences', () => {
  it('saves the whole set and puts the answer where every reader of it looks', async () => {
    let sent: unknown
    const wrapper = createHookWrapper({
      'GET /api/me/preferences': () => jsonResponse(200, { animatedImages: 'brief' }),
      'PUT /api/me/preferences': async (request) => {
        sent = await request.json()
        return jsonResponse(200, { animatedImages: 'never' })
      },
    })
    const { result } = renderHook(
      () => ({ read: usePersonPreferences(), save: useSavePersonPreferences() }),
      { wrapper },
    )
    await waitFor(() => {
      expect(result.current.read.data).toEqual({ animatedImages: 'brief' })
    })
    await act(() => result.current.save.mutateAsync({ animatedImages: 'never' }))
    expect(sent).toEqual({ animatedImages: 'never' })
    await waitFor(() => {
      expect(result.current.read.data).toEqual({ animatedImages: 'never' })
    })
  })
})
