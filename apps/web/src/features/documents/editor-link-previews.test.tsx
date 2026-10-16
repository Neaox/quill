import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createHookWrapper } from '../../lib/api/hook-wrapper.tsx'
import { jsonResponse } from '../../lib/api/testing.ts'
import { useEditorLinkPreviews } from './editor-link-previews.ts'

const URL_A = 'https://blog.example/post'
const URL_B = 'https://other.example/story'
const preview = (url: string) => ({
  url,
  canonicalUrl: url,
  title: `Title of ${url}`,
  description: null,
  siteName: null,
  kind: 'website',
  thumbnail: null,
  favicon: null,
  layer: 'page',
  fetchedAt: '2026-01-01T00:00:00.000Z',
})

function wrapper(views: Record<string, unknown>) {
  const asked: string[] = []
  return {
    asked,
    wrapper: createHookWrapper({
      'POST /api/link-previews/resolve': async (request) => {
        const { urls } = (await request.json()) as { urls: string[] }
        asked.push(...urls)
        return jsonResponse(200, {
          previews: urls.map((url) => ({ url, view: views[url] ?? { state: 'pending' } })),
        })
      },
    }),
  }
}

describe('useEditorLinkPreviews', () => {
  it('knows nothing about an address nobody has asked about', () => {
    const { wrapper: Wrapper } = wrapper({})
    const { result } = renderHook(() => useEditorLinkPreviews(), { wrapper: Wrapper })
    expect(result.current.preview(URL_A)).toBeNull()
  })

  it('asks for an address once it is asked about, and hands back a preview that is ready', async () => {
    const { wrapper: Wrapper, asked } = wrapper({
      [URL_A]: { state: 'ready', preview: preview(URL_A), stale: false },
    })
    const { result } = renderHook(() => useEditorLinkPreviews(), { wrapper: Wrapper })

    act(() => {
      result.current.request(URL_A)
      result.current.request(URL_A)
    })

    await waitFor(() => expect(result.current.preview(URL_A)?.title).toBe(`Title of ${URL_A}`))
    expect(asked).toEqual([URL_A])
  })

  it('hands back nothing for a link whose preview has not arrived, rather than an error', async () => {
    const { wrapper: Wrapper, asked } = wrapper({})
    const { result } = renderHook(() => useEditorLinkPreviews(), { wrapper: Wrapper })

    act(() => {
      result.current.request(URL_B)
    })

    await waitFor(() => expect(asked).toEqual([URL_B]))
    expect(result.current.preview(URL_B)).toBeNull()
  })

  it('serves pictures from our own origin', () => {
    const { wrapper: Wrapper } = wrapper({})
    const { result } = renderHook(() => useEditorLinkPreviews(), { wrapper: Wrapper })
    expect(result.current.imageUrl({ hash: 'a'.repeat(64), width: 1, height: 1 })).toBe(
      `/link-previews/images/${'a'.repeat(64)}`,
    )
  })
})
