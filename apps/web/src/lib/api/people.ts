import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { PeopleDirectory, Person } from '@quill/editor'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'

/**
 * The people directory, for the owner picker in the properties line
 * (`GET /api/documents/:id/people`; `docs/design/properties.md`).
 *
 * The adapter behind `@quill/editor`'s `PeopleDirectory` port. Two things are
 * asked of it: the names behind every address the draft holds — one request
 * for all of them, refetched only when the set of addresses changes — and a
 * search as the author types. A search's answers are kept in the query cache,
 * and a person found there is named straight away when they are added,
 * before the next names request returns.
 *
 * The server answers only someone who may edit the document, so this is only
 * offered to them; anyone else sees owners as written.
 */

interface PeopleAnswer {
  readonly people: readonly Person[]
}

const FRESH_FOR_MS = 5 * 60 * 1000

export function usePeopleDirectory(
  documentId: string,
  values: readonly string[],
  enabled: boolean,
): PeopleDirectory | undefined {
  const client = useApiClient()
  const queryClient = useQueryClient()
  const addresses = [...new Set(values.filter((value) => value.includes('@')))].toSorted()

  const named = useQuery({
    queryKey: [...queryKeys.people(documentId), 'named', addresses],
    queryFn: ({ signal }) =>
      request<PeopleAnswer>(
        client.GET('/api/documents/{id}/people', {
          params: { path: { id: documentId }, query: { email: addresses } },
          signal,
        }),
      ),
    enabled: enabled && addresses.length > 0,
    staleTime: FRESH_FOR_MS,
    // The names already shown stay while a changed set of addresses is asked about.
    placeholderData: keepPreviousData,
  })

  return useMemo(() => {
    if (!enabled) return undefined
    const names = new Map(
      named.data?.people.map((person) => [person.value.toLowerCase(), person.name]),
    )
    return {
      nameOf(value: string): string | undefined {
        const wanted = value.toLowerCase()
        const known = names.get(wanted)
        if (known !== undefined) return known
        const searches = queryClient.getQueriesData<PeopleAnswer>({
          queryKey: [...queryKeys.people(documentId), 'search'],
        })
        for (const [, answer] of searches) {
          const found = answer?.people.find((person) => person.value.toLowerCase() === wanted)
          if (found !== undefined) return found.name
        }
        return undefined
      },
      search(query: string, signal: AbortSignal): Promise<readonly Person[]> {
        return queryClient
          .fetchQuery({
            queryKey: [...queryKeys.people(documentId), 'search', query],
            queryFn: () =>
              request<PeopleAnswer>(
                client.GET('/api/documents/{id}/people', {
                  params: { path: { id: documentId }, query: { q: query } },
                  signal,
                }),
              ),
            staleTime: FRESH_FOR_MS,
          })
          .then((answer) => answer.people)
      },
    }
  }, [enabled, named.data, queryClient, client, documentId])
}
