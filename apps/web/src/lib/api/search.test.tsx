import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from './errors.ts'
import { createHookWrapper } from './hook-wrapper.tsx'
import { errorResponse, jsonResponse } from './testing.ts'
import { readInvalidQuery, useSearch, useSearchResults, useSearchSuggestions } from './search.ts'
import { searchHitFixture } from './search-fixtures.ts'
import type { FacetName, SearchHit, SearchResults } from './types.ts'

function hit(title: string, overrides: Partial<SearchHit> = {}) {
  return searchHitFixture(title, {
    snippet: { text: 'A regional failover runbook.', ranges: [{ start: 11, end: 19 }] },
    score: 0.9,
    ...overrides,
  })
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

  it('asks for facets on the first page only, so paging never re-counts or loses them', async () => {
    const facets = { tag: [{ value: 'api', label: 'api', count: 3 }] }
    const { asked, routes } = recordingRoutes([
      { ...PAGE, nextCursor: '1', facets },
      { query: 'failover', current: [hit('Failover drill')], elsewhere: [] },
    ])
    const { result } = renderHook(
      () =>
        useSearchResults({
          query: 'failover',
          workspaceId: 'ws-1',
          facets: ['tag', 'status', 'collection'],
        }),
      { wrapper: createHookWrapper(routes) },
    )

    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(true)
    })
    await result.current.fetchNextPage()
    await waitFor(() => {
      expect(result.current.data?.pages).toHaveLength(2)
    })

    expect(new URLSearchParams(asked[0]).get('facets')).toBe('tag,status,collection')
    expect(new URLSearchParams(asked[1]).has('facets')).toBe(false)
    expect(result.current.data?.pages[0]?.facets).toEqual(facets)
  })

  it('sends no facets parameter when none are wanted', async () => {
    const { asked, routes } = recordingRoutes([PAGE])
    const { result } = renderHook(
      () => useSearchResults({ query: 'failover', workspaceId: 'ws-1', facets: [] }),
      { wrapper: createHookWrapper(routes) },
    )

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    expect(new URLSearchParams(asked[0]).has('facets')).toBe(false)
  })

  it('keeps answers with and without facets apart in the cache', async () => {
    const { asked, routes } = recordingRoutes([PAGE])
    const { result, rerender } = renderHook(
      ({ facets }: { facets: readonly FacetName[] }) =>
        useSearchResults({ query: 'failover', workspaceId: 'ws-1', facets }),
      { wrapper: createHookWrapper(routes), initialProps: { facets: [] as readonly FacetName[] } },
    )
    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })

    rerender({ facets: ['tag'] })

    await waitFor(() => {
      expect(asked).toHaveLength(2)
    })
    expect(new URLSearchParams(asked[1]).get('facets')).toBe('tag')
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

function suggestionRoutes(answer: (url: URL) => unknown) {
  const asked: URL[] = []
  return {
    asked,
    routes: {
      'GET /api/search/suggestions': (request: Request) => {
        const url = new URL(request.url)
        asked.push(url)
        return jsonResponse(200, answer(url))
      },
    },
  }
}

describe('useSearchSuggestions', () => {
  const ADA = { suggestions: [{ value: 'ada', label: 'Ada Lovelace' }] }

  it('asks nothing until a field is given', async () => {
    const { asked, routes } = suggestionRoutes(() => ADA)
    const { result } = renderHook(
      () => useSearchSuggestions({ field: undefined, prefix: 'a', workspaceId: 'ws-1' }),
      { wrapper: createHookWrapper(routes) },
    )

    await waitFor(() => {
      expect(result.current.isPending).toBe(true)
    })
    expect(result.current.fetchStatus).toBe('idle')
    expect(asked).toEqual([])
  })

  it('sends the field, the prefix and the workspace it was typed in', async () => {
    const { asked, routes } = suggestionRoutes((url) => ({
      field: url.searchParams.get('field'),
      ...ADA,
    }))
    const { result } = renderHook(
      () => useSearchSuggestions({ field: 'by', prefix: 'ad', workspaceId: 'ws-1' }),
      { wrapper: createHookWrapper(routes) },
    )

    await waitFor(() => {
      expect(result.current.data).toEqual({ field: 'by', ...ADA })
    })
    const params = asked[0]?.searchParams
    expect(params?.get('field')).toBe('by')
    expect(params?.get('prefix')).toBe('ad')
    expect(params?.get('workspace')).toBe('ws-1')
  })

  it('omits the prefix and the workspace when there are none', async () => {
    const { asked, routes } = suggestionRoutes(() => ADA)
    const { result } = renderHook(
      () => useSearchSuggestions({ field: 'tag', prefix: '', workspaceId: null }),
      { wrapper: createHookWrapper(routes) },
    )

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    expect(asked[0]?.searchParams.has('prefix')).toBe(false)
    expect(asked[0]?.searchParams.has('workspace')).toBe(false)
  })

  it('keeps the previous answer on show while the next one is fetched', async () => {
    const { routes } = suggestionRoutes((url) => ({
      field: 'by',
      suggestions: [{ value: url.searchParams.get('prefix') ?? '', label: 'x' }],
    }))
    const { result, rerender } = renderHook(
      ({ prefix }: { prefix: string }) =>
        useSearchSuggestions({ field: 'by', prefix, workspaceId: null }),
      { wrapper: createHookWrapper(routes), initialProps: { prefix: 'a' } },
    )
    await waitFor(() => {
      expect(result.current.data?.suggestions[0]?.value).toBe('a')
    })

    rerender({ prefix: 'ad' })

    expect(result.current.data?.suggestions[0]?.value).toBe('a')
    expect(result.current.isPlaceholderData).toBe(true)
    await waitFor(() => {
      expect(result.current.data?.suggestions[0]?.value).toBe('ad')
    })
  })

  it('reports a failure rather than inventing suggestions', async () => {
    const { result } = renderHook(
      () => useSearchSuggestions({ field: 'by', prefix: 'a', workspaceId: null }),
      {
        wrapper: createHookWrapper({
          'GET /api/search/suggestions': () => errorResponse(500, 'internal', 'no'),
        }),
      },
    )

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
  })
})
