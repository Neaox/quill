import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from './errors.ts'
import { createHookWrapper } from './hook-wrapper.tsx'
import { errorResponse, jsonResponse } from './testing.ts'
import { readInvalidQuery, useSearch, useSearchResults } from './search.ts'
import type { SearchResults } from './types.ts'

function hit(title: string, overrides: Partial<SearchResults['current'][number]> = {}) {
  return {
    documentId: `doc-${title}`,
    shortId: 'k7m3q9v2xd',
    slug: 'regional-failover',
    title,
    path: 'runbooks/regional-failover',
    workspaceId: 'ws-1',
    breadcrumb: ['Engineering', 'Runbooks'],
    snippet: { text: 'A regional failover runbook.', ranges: [{ start: 11, end: 19 }] },
    score: 0.9,
    ...overrides,
  }
}

const PAGE: SearchResults = {
  query: 'failover',
  current: [hit('Regional failover')],
  elsewhere: [
    {
      workspace: { id: 'ws-2', slug: 'platform-docs', name: 'Platform docs' },
      hits: [hit('Platform team charter', { workspaceId: 'ws-2' })],
    },
  ],
}

/** Captures the querystring each request carried, so the route can be asserted on. */
function recordingRoutes(pages: readonly SearchResults[]) {
  const asked: string[] = []
  return {
    asked,
    routes: {
      'GET /api/search': (request: Request) => {
        const url = new URL(request.url)
        asked.push(url.search)
        const cursor = url.searchParams.get('cursor')
        const index = cursor === null ? 0 : Number(cursor)
        return jsonResponse(200, pages[index])
      },
    },
  }
}

describe('useSearch', () => {
  it('asks nothing at all until there is something to search for', async () => {
    const { asked, routes } = recordingRoutes([PAGE])
    const { result } = renderHook(() => useSearch({ query: '   ', workspaceId: 'ws-1' }), {
      wrapper: createHookWrapper(routes),
    })

    await waitFor(() => {
      expect(result.current.isPending).toBe(true)
    })
    expect(asked).toEqual([])
  })

  it('sends the query, the workspace it was run from, and the limit', async () => {
    const { asked, routes } = recordingRoutes([PAGE])
    const { result } = renderHook(
      () => useSearch({ query: 'failover', workspaceId: 'ws-1', limit: 5 }),
      { wrapper: createHookWrapper(routes) },
    )

    await waitFor(() => {
      expect(result.current.data).toEqual(PAGE)
    })
    expect(asked).toHaveLength(1)
    const params = new URLSearchParams(asked[0])
    expect(params.get('q')).toBe('failover')
    expect(params.get('workspace')).toBe('ws-1')
    expect(params.get('limit')).toBe('5')
  })

  it('omits the workspace entirely when the search is run from outside one', async () => {
    const { asked, routes } = recordingRoutes([PAGE])
    const { result } = renderHook(() => useSearch({ query: 'failover', workspaceId: null }), {
      wrapper: createHookWrapper(routes),
    })

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    expect(new URLSearchParams(asked[0]).has('workspace')).toBe(false)
  })

  it('trims what was typed, so a trailing space is not a different search', async () => {
    const { asked, routes } = recordingRoutes([PAGE])
    const { result } = renderHook(() => useSearch({ query: '  failover  ', workspaceId: null }), {
      wrapper: createHookWrapper(routes),
    })

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    expect(new URLSearchParams(asked[0]).get('q')).toBe('failover')
  })

  it('surfaces a refused query as the typed error the field can underline', async () => {
    const { result } = renderHook(() => useSearch({ query: 'owner:', workspaceId: null }), {
      wrapper: createHookWrapper({
        'GET /api/search': () =>
          errorResponse(422, 'invalid_query', 'That filter has no value', {
            kind: 'empty-filter-value',
            position: 6,
          }),
      }),
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    expect(readInvalidQuery(result.current.error)).toEqual({
      kind: 'empty-filter-value',
      position: 6,
      message: 'That filter has no value',
    })
  })
})

describe('useSearchResults', () => {
  it('pages through with the cursor the previous page carried', async () => {
    const { asked, routes } = recordingRoutes([
      { ...PAGE, nextCursor: '1' },
      { query: 'failover', current: [hit('Failover drill')], elsewhere: [] },
    ])
    const { result } = renderHook(
      () => useSearchResults({ query: 'failover', workspaceId: 'ws-1' }),
      {
        wrapper: createHookWrapper(routes),
      },
    )

    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(true)
    })
    expect(new URLSearchParams(asked[0]).has('cursor')).toBe(false)

    await result.current.fetchNextPage()

    await waitFor(() => {
      expect(result.current.data?.pages).toHaveLength(2)
    })
    expect(new URLSearchParams(asked[1]).get('cursor')).toBe('1')
    expect(result.current.hasNextPage).toBe(false)
  })

  it('stops offering more once a page comes back without a cursor', async () => {
    const { routes } = recordingRoutes([PAGE])
    const { result } = renderHook(
      () => useSearchResults({ query: 'failover', workspaceId: null }),
      {
        wrapper: createHookWrapper(routes),
      },
    )

    await waitFor(() => {
      expect(result.current.data?.pages).toHaveLength(1)
    })
    expect(result.current.hasNextPage).toBe(false)
  })
})

describe('readInvalidQuery', () => {
  it('reads nothing from a failure that is not a refused query', () => {
    expect(readInvalidQuery(new Error('offline'))).toBeUndefined()
    expect(readInvalidQuery(new ApiError(500, { code: 'internal', message: 'no' }))).toBeUndefined()
  })

  it('reads nothing from a refusal whose details are not the documented shape', () => {
    const missing = new ApiError(422, { code: 'invalid_query', message: 'no' })
    expect(readInvalidQuery(missing)).toBeUndefined()

    const wrong = new ApiError(422, {
      code: 'invalid_query',
      message: 'no',
      details: { kind: 7, position: 'here' },
    })
    expect(readInvalidQuery(wrong)).toBeUndefined()
  })
})
