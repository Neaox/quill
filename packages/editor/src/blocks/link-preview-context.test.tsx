import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { NO_LINK_PREVIEWS, useLinkPreviewSource } from './link-preview-context.tsx'

describe('the link preview source an editor starts with', () => {
  it('knows nothing, asks for nothing, and has no pictures to serve', () => {
    const { result } = renderHook(() => useLinkPreviewSource())
    expect(result.current).toBe(NO_LINK_PREVIEWS)
    expect(result.current.preview('https://blog.example/post')).toBeNull()
    expect(result.current.request('https://blog.example/post')).toBeUndefined()
    expect(result.current.imageUrl({ hash: 'a'.repeat(64), width: 1, height: 1 })).toBe('')
  })
})
