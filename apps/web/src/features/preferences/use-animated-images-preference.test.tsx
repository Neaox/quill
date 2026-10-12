import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { createHookWrapper } from '../../lib/api/hook-wrapper.tsx'
import { jsonResponse } from '../../lib/api/testing.ts'
import { useAnimatedImagesPreference } from './use-animated-images-preference.ts'

afterEach(() => {
  document.documentElement.removeAttribute('data-animated-images')
  localStorage.removeItem('animated-images-preference')
})

describe('useAnimatedImagesPreference', () => {
  it('puts the person’s preference on the page and mirrors it for the public site', async () => {
    const wrapper = createHookWrapper({
      'GET /api/me/preferences': () => jsonResponse(200, { animatedImages: 'never' }),
    })
    renderHook(
      () => {
        useAnimatedImagesPreference()
      },
      { wrapper },
    )
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-animated-images')).toBe('never')
    })
    expect(localStorage.getItem('animated-images-preference')).toBe('never')
  })

  it('writes nothing until the preference is known', () => {
    const wrapper = createHookWrapper({
      'GET /api/me/preferences': () => new Promise<Response>(() => undefined),
    })
    renderHook(
      () => {
        useAnimatedImagesPreference()
      },
      { wrapper },
    )
    expect(document.documentElement.hasAttribute('data-animated-images')).toBe(false)
    expect(localStorage.getItem('animated-images-preference')).toBeNull()
  })
})
