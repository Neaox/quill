import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createHookWrapper } from '../../lib/api/hook-wrapper.tsx'
import { errorResponse, jsonResponse } from '../../lib/api/testing.ts'
import type { FakeRoutes } from '../../lib/api/testing.ts'
import { organisationSettings, readOrganisation } from '../settings/settings-fixtures.ts'
import { useEditorLinkPreviews } from './editor-link-previews.ts'

const URL_A = 'https://blog.example/post'
const preview = (url: string, layer = 'open-graph') => ({
  url,
  canonicalUrl: url,
  title: `Title of ${url}`,
  description: null,
  siteName: null,
  kind: 'website',
  thumbnail: null,
  favicon: null,
  layer,
  fetchedAt: '2026-10-15T09:00:00.000Z',
})

function hook(views: Record<string, unknown>, extra: FakeRoutes = {}) {
  return renderHook(() => useEditorLinkPreviews(), {
    wrapper: createHookWrapper({
      'POST /api/link-previews/resolve': async (request) => {
        const { urls } = (await request.json()) as { urls: string[] }
        return jsonResponse(200, {
          previews: urls.map((url) => ({ url, view: views[url] ?? { state: 'pending' } })),
        })
      },
      'GET /api/settings/organisation': readOrganisation(),
      ...extra,
    }),
  })
}

describe('where a link’s preview stands, for the editor’s toolbar', () => {
  it('is nothing for an address nobody asked about', () => {
    const { result } = hook({})
    expect(result.current.state?.(URL_A)).toBeNull()
  })

  it.each([
    [{ state: 'ready', preview: preview(URL_A), stale: false }, 'ready'],
    [{ state: 'pending' }, 'pending'],
    [{ state: 'unavailable', reason: 'unreachable' }, 'unavailable'],
    [{ state: 'blocked' }, 'blocked'],
  ])('is %j once it has been asked', async (view, expected) => {
    const { result } = hook({ [URL_A]: view })
    act(() => {
      result.current.request(URL_A)
    })
    await waitFor(() => {
      expect(result.current.state?.(URL_A)).toBe(expected)
    })
  })

  it('hands back where a ready preview came from and when, for the status line', async () => {
    const { result } = hook({
      [URL_A]: { state: 'ready', preview: preview(URL_A, 'oembed'), stale: false },
    })
    act(() => {
      result.current.request(URL_A)
    })
    await waitFor(() => {
      expect(result.current.preview(URL_A)).toMatchObject({
        layer: 'oembed',
        fetchedAt: '2026-10-15T09:00:00.000Z',
      })
    })
  })
})

const refreshRoute = (respond: () => Response): FakeRoutes => ({
  'POST /api/link-previews/refresh': respond,
})

describe('refreshing a link’s preview from the editor', () => {
  it('starts a fresh fetch, and the answer replaces what the editor knew', async () => {
    const { result } = hook(
      { [URL_A]: { state: 'unavailable', reason: 'unreachable' } },
      refreshRoute(() =>
        jsonResponse(200, { state: 'ready', preview: preview(URL_A), stale: true }),
      ),
    )
    act(() => {
      result.current.request(URL_A)
    })
    await waitFor(() => {
      expect(result.current.state?.(URL_A)).toBe('unavailable')
    })

    let outcome: unknown
    await act(async () => {
      outcome = await result.current.refresh?.(URL_A)
    })

    expect(outcome).toBe('started')
    await waitFor(() => {
      expect(result.current.state?.(URL_A)).toBe('ready')
    })
  })

  it('says it was asked too often, quietly, when the server rate-limits it', async () => {
    const { result } = hook(
      {},
      refreshRoute(() => errorResponse(429, 'rate_limited', 'Slow down')),
    )
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.refresh?.(URL_A)
    })
    expect(outcome).toBe('rate_limited')
  })

  it('says the organisation does not allow it when the server refuses the address', async () => {
    const { result } = hook(
      {},
      refreshRoute(() => errorResponse(403, 'forbidden', 'Not allowed')),
    )
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.refresh?.(URL_A)
    })
    expect(outcome).toBe('blocked')
  })

  it('says it failed for anything else, and never throws into the page', async () => {
    const { result } = hook(
      {},
      refreshRoute(() => errorResponse(500, 'internal', 'Broken')),
    )
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.refresh?.(URL_A)
    })
    expect(outcome).toBe('failed')
  })

  it('is in flight only while the request is', async () => {
    const gate = Promise.withResolvers<void>()
    const { result } = hook(
      {},
      {
        'POST /api/link-previews/refresh': async () => {
          await gate.promise
          return jsonResponse(200, { state: 'pending' })
        },
      },
    )
    expect(result.current.refreshing).toBe(false)
    let done: Promise<unknown> = Promise.resolve()
    act(() => {
      done = result.current.refresh?.(URL_A) ?? Promise.resolve()
    })
    await waitFor(() => {
      expect(result.current.refreshing).toBe(true)
    })
    gate.resolve()
    await act(async () => {
      await done
    })
    await waitFor(() => {
      expect(result.current.refreshing).toBe(false)
    })
  })
})

describe('the organisation’s link settings, for the editor', () => {
  it('give the shipped defaults when the organisation never saved any', async () => {
    const { result } = hook({})
    await waitFor(() => {
      expect(result.current.defaultDisplay).toBe('inline')
    })
    expect(result.current.publicSite).toBe(true)
  })

  it('give what the organisation saved', async () => {
    const { result } = hook(
      {},
      {
        'GET /api/settings/organisation': readOrganisation(
          organisationSettings({
            linkPreviews: {
              mode: 'rich',
              publicSite: false,
              defaultDisplay: 'card',
              allow: [],
              block: [],
            },
          }),
        ),
      },
    )
    await waitFor(() => {
      expect(result.current.defaultDisplay).toBe('card')
    })
    expect(result.current.publicSite).toBe(false)
  })

  it('give nothing until the settings have loaded, so the editor claims no default it does not know', () => {
    const { result } = hook({})
    expect(result.current.defaultDisplay).toBeUndefined()
    expect(result.current.publicSite).toBeUndefined()
  })
})
