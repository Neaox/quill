import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createHookWrapper } from '../../lib/api/hook-wrapper.tsx'
import { errorResponse, jsonResponse } from '../../lib/api/testing.ts'
import { FILTERS } from './search-filters.ts'
import { isSuggestionField, useFilterTypeahead } from './use-filter-typeahead.tsx'

const PEOPLE = [
  { value: 'ada', label: 'Ada Lovelace' },
  { value: 'sam', label: 'Sam Taylor' },
]

function routes(
  answer: (url: URL) => Response = () => jsonResponse(200, { field: 'by', suggestions: PEOPLE }),
) {
  const asked: URL[] = []
  return {
    asked,
    routes: {
      'GET /api/search/suggestions': (request: Request) => {
        const url = new URL(request.url)
        asked.push(url)
        return answer(url)
      },
    },
  }
}

function typeahead(text: string, caret: number | null, fake = routes()) {
  return {
    fake,
    ...renderHook(
      (props: { text: string; caret: number | null }) =>
        useFilterTypeahead({ ...props, workspaceId: 'ws-1' }),
      { wrapper: createHookWrapper(fake.routes), initialProps: { text, caret } },
    ),
  }
}

describe('isSuggestionField', () => {
  it('is exactly the filters the server can suggest values for', () => {
    expect(
      FILTERS.filter((filter) => isSuggestionField(filter.key)).map((filter) => filter.key),
    ).toEqual(['by', 'team', 'tag', 'collection', 'in', 'status'])
    expect(isSuggestionField('owner')).toBe(false)
  })
})

describe('useFilterTypeahead', () => {
  it('offers nothing until the caret has been somewhere', () => {
    const { result, fake } = typeahead('by:', null)

    expect(result.current.groups).toEqual([])
    expect(result.current.notice).toBeUndefined()
    expect(fake.asked).toEqual([])
  })

  it('offers nothing in whitespace, or for a word that begins no filter', () => {
    expect(typeahead('by:ada ', 7).result.current.groups).toEqual([])
    expect(typeahead('failover', 8).result.current.groups).toEqual([])
    expect(typeahead('', 0).result.current.groups).toEqual([])
  })

  it('does not treat a quoted phrase as the start of a filter', () => {
    expect(typeahead('"te', 3).result.current.groups).toEqual([])
    expect(typeahead('-"te', 4).result.current.groups).toEqual([])
  })

  it('offers the filters a half-typed word begins, with what each finds', () => {
    const { result } = typeahead('foo te', 6)

    const [group] = result.current.groups
    expect(group?.label).toBe('Filters')
    expect(group?.options.map((option) => option.id)).toEqual(['filter:team'])
    expect(result.current.status).toBe('1 suggestion')
    expect(result.current.keepsOpen('filter:team')).toBe(true)
    expect(result.current.keepsOpen('value:0')).toBe(false)
  })

  it('completes a filter name and carries on to its values', () => {
    const { result } = typeahead('foo te', 6)

    expect(result.current.accept('filter:team')).toEqual({ text: 'foo team:', caret: 9 })
  })

  it('asks the server for the values after a pause, and lists them under the filter’s name', async () => {
    const { result, fake } = typeahead('by:ad', 5)

    expect(result.current.busy).toBe(true)
    expect(result.current.notice).toBe('Searching…')
    await waitFor(() => {
      expect(result.current.groups[0]?.options).toHaveLength(2)
    })
    expect(result.current.groups[0]?.label).toBe('By')
    expect(result.current.groups[0]?.options.map((option) => [option.id, option.label])).toEqual([
      ['value:0', 'Ada Lovelace'],
      ['value:1', 'Sam Taylor'],
    ])
    expect(result.current.status).toBe('2 suggestions')
    expect(result.current.busy).toBe(false)
    expect(fake.asked).toHaveLength(1)
    expect(fake.asked[0]?.searchParams.get('field')).toBe('by')
    expect(fake.asked[0]?.searchParams.get('prefix')).toBe('ad')
    expect(fake.asked[0]?.searchParams.get('workspace')).toBe('ws-1')
  })

  it('applies a chosen value in place of the token, keeping what follows', async () => {
    const { result } = typeahead('-by:a tag:x', 5)
    await waitFor(() => {
      expect(result.current.groups).toHaveLength(1)
    })

    expect(result.current.accept('value:1')).toEqual({ text: '-by:sam tag:x', caret: 7 })
  })

  it('says so when there is nothing to suggest', async () => {
    const { result } = typeahead(
      'tag:zzz',
      7,
      routes(() => jsonResponse(200, { field: 'tag', suggestions: [] })),
    )

    await waitFor(() => {
      expect(result.current.notice).toBe('Nothing suggested')
    })
    expect(result.current.groups).toEqual([])
    expect(result.current.status).toBe('No suggestions')
  })

  it('stays quiet when suggestions cannot be fetched', async () => {
    const { result, fake } = typeahead(
      'by:a',
      4,
      routes(() => errorResponse(500, 'internal', 'no')),
    )

    await waitFor(() => {
      expect(fake.asked).toHaveLength(1)
    })
    await waitFor(() => {
      expect(result.current.busy).toBe(false)
    })
    expect(result.current.groups).toEqual([])
    expect(result.current.notice).toBeUndefined()
    expect(result.current.status).toBeUndefined()
  })

  it('does not show one filter’s values under another’s name', async () => {
    const { result, rerender } = typeahead('by:a', 4)
    await waitFor(() => {
      expect(result.current.groups[0]?.label).toBe('By')
    })

    rerender({ text: 'tag:a', caret: 5 })

    expect(result.current.groups).toEqual([])
    expect(result.current.notice).toBe('Searching…')
  })

  it('offers no values for a filter that has none to suggest, and does not ask', () => {
    const { result, fake } = typeahead('owner:ad', 8)

    expect(result.current.groups).toEqual([])
    expect(fake.asked).toEqual([])
  })

  it('has nothing to accept when it offered nothing', () => {
    const { result } = typeahead('failover', 8)

    expect(result.current.accept('value:0')).toBeUndefined()
    expect(result.current.accept('filter:team')).toBeUndefined()
  })

  it('ignores an option it did not offer', async () => {
    const { result } = typeahead('by:a', 4)
    await waitFor(() => {
      expect(result.current.groups).toHaveLength(1)
    })

    expect(result.current.accept('value:9')).toBeUndefined()
    expect(result.current.accept('other')).toBeUndefined()
  })

  it('ignores a filter name it did not offer', () => {
    const { result } = typeahead('foo te', 6)

    expect(result.current.accept('filter:nope')).toBeUndefined()
  })
})
