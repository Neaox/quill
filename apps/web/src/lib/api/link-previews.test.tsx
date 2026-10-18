import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createHookWrapper } from './hook-wrapper.tsx'
import { useLinkPreview, useRefreshLinkPreview } from './link-previews.ts'
import { errorResponse, jsonResponse } from './testing.ts'

const URL_A = 'https://blog.example/post'
const PREVIEW = {
  url: URL_A,
  canonicalUrl: URL_A,
  title: 'A title',
  description: null,
  siteName: 'Blog',
  kind: 'article',
  thumbnail: null,
  favicon: null,
  layer: 'open-graph',
  fetchedAt: '2026-01-01T00:00:00.000Z',
}
const READY = { state: 'ready', preview: PREVIEW, stale: false }

describe('useLinkPreview', () => {
  it('asks about the one address and answers what the server says of it', async () => {
    const bodies: unknown[] = []
    const { result } = renderHook(() => useLinkPreview(URL_A), {
      wrapper: createHookWrapper({
        'POST /api/link-previews/resolve': async (request) => {
          bodies.push(await request.json())
          return jsonResponse(200, { previews: [{ url: URL_A, view: READY }] })
        },
      }),
    })
    await waitFor(() => expect(result.current.data).toEqual(READY))
    expect(bodies).toEqual([{ urls: [URL_A] }])
  })

  it('asks nothing while it is not wanted', () => {
    const { result } = renderHook(() => useLinkPreview(URL_A, { enabled: false }), {
      wrapper: createHookWrapper(),
    })
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('reads a link the server cannot say anything about as plain, not as an error', async () => {
    const { result } = renderHook(() => useLinkPreview(URL_A), {
      wrapper: createHookWrapper({
        'POST /api/link-previews/resolve': () => jsonResponse(200, { previews: [] }),
      }),
    })
    await waitFor(() =>
      expect(result.current.data).toEqual({ state: 'unavailable', reason: 'invalid_url' }),
    )
  })
})

describe('useRefreshLinkPreview', () => {
  it('asks for a fresh preview and puts the answer where readers look', async () => {
    const { result } = renderHook(
      () => ({ read: useLinkPreview(URL_A, { enabled: false }), refresh: useRefreshLinkPreview() }),
      {
        wrapper: createHookWrapper({
          'POST /api/link-previews/refresh': () => jsonResponse(200, READY),
        }),
      },
    )
    result.current.refresh.mutate(URL_A)
    await waitFor(() => expect(result.current.read.data).toEqual(READY))
  })

  it('surfaces a refusal as an error the caller can say something about', async () => {
    const { result } = renderHook(() => useRefreshLinkPreview(), {
      wrapper: createHookWrapper({
        'POST /api/link-previews/refresh': () => errorResponse(403, 'forbidden', 'Not allowed'),
      }),
    })
    result.current.mutate(URL_A)
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
