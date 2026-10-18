import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createHookWrapper } from './hook-wrapper.tsx'
import { usePeopleDirectory } from './people.ts'
import { jsonResponse } from './testing.ts'

const PEOPLE = [
  { value: 'ada@example.com', name: 'Ada Lovelace', detail: 'ada@example.com' },
  { value: 'grace@example.com', name: 'Grace Hopper', detail: 'grace@example.com' },
]

function routes(asked: URL[]) {
  return {
    'GET /api/documents/{id}/people': (request: Request) => {
      const url = new URL(request.url)
      asked.push(url)
      const emails = new Set(url.searchParams.getAll('email').map((email) => email.toLowerCase()))
      const q = url.searchParams.get('q')?.toLowerCase()
      return jsonResponse(200, {
        people: PEOPLE.filter((person) =>
          q === undefined ? emails.has(person.value) : person.name.toLowerCase().includes(q),
        ),
      })
    },
  }
}

describe('the people directory for one document', () => {
  it('names every address the document holds in one request, and nothing else', async () => {
    const asked: URL[] = []
    const { result } = renderHook(
      () => usePeopleDirectory('doc-1', ['ada@example.com', 'platform', 'ada@example.com'], true),
      { wrapper: createHookWrapper(routes(asked)) },
    )
    await waitFor(() => {
      expect(result.current?.nameOf('ada@example.com')).toBe('Ada Lovelace')
    })
    expect(result.current?.nameOf('ADA@example.com')).toBe('Ada Lovelace')
    expect(result.current?.nameOf('platform')).toBeUndefined()
    expect(asked).toHaveLength(1)
    expect(asked[0]?.searchParams.getAll('email')).toEqual(['ada@example.com'])
  })

  it('searches, and remembers whom it found so a new owner is named at once', async () => {
    const asked: URL[] = []
    const { result } = renderHook(() => usePeopleDirectory('doc-1', [], true), {
      wrapper: createHookWrapper(routes(asked)),
    })
    const directory = result.current
    if (directory === undefined) throw new Error('No directory')
    const found = await directory.search('gra', new AbortController().signal)
    expect(found.map((person) => person.name)).toEqual(['Grace Hopper'])
    expect(directory.nameOf('grace@example.com')).toBe('Grace Hopper')
    expect(asked).toHaveLength(1)
  })

  it('is not offered to someone who cannot edit, because the server would refuse them', () => {
    const { result } = renderHook(() => usePeopleDirectory('doc-1', ['ada@example.com'], false), {
      wrapper: createHookWrapper({}),
    })
    expect(result.current).toBeUndefined()
  })
})
