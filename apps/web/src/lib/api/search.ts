import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'

import type { ApiClient } from '@quill/api-client'

import { useApiClient } from './client-context.tsx'
import { ApiError } from './errors.ts'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type { SearchResults } from './types.ts'

/**
 * `GET /api/search`, for both surfaces that read it: the command palette,
 * which asks for one short page as somebody types, and the results page,
 * which pages through the whole answer.
 *
 * One module, because they are the same request with different limits, and a
 * second spelling of it would be a second chance for the two to disagree
 * about what a cursor means or which workspace the search was run from.
 */

/** What the palette shows without scrolling; the results page asks for more. */
export const PALETTE_LIMIT = 8

/** The results page's page size. The server's own default and maximum are 20 and 50. */
export const RESULTS_LIMIT = 20

export interface SearchInput {
  /** Exactly what was typed. Trimmed here, so a trailing space is not a new search. */
  readonly query: string
  /**
   * The workspace the search is being run *from*, by id or slug (ADR-035), or
   * `null` outside one. It changes what is preferred, never what is visible:
   * matches there come back in `current` and everything else is grouped under
   * `elsewhere` (quill-plan.md §15).
   */
  readonly workspaceId: string | null
  readonly limit?: number
}

function fetchPage(
  client: ApiClient,
  input: SearchInput,
  cursor: string | undefined,
): Promise<SearchResults> {
  return request(
    client.GET('/api/search', {
      params: {
        query: {
          q: input.query.trim(),
          ...(input.workspaceId === null ? {} : { workspace: input.workspaceId }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(cursor === undefined ? {} : { cursor }),
        },
      },
    }),
  )
}

/**
 * One page, for the palette.
 *
 * `enabled` on a query with something in it: `q` has a minimum length of one
 * on the wire, so asking with an empty box would be a 400 rather than an
 * empty list — and an empty box is not a search anyway.
 */
export function searchQueryOptions(client: ApiClient, input: SearchInput) {
  const query = input.query.trim()
  return {
    queryKey: queryKeys.search(input.workspaceId, query, null),
    queryFn: () => fetchPage(client, input, undefined),
    enabled: query !== '',
    // The previous answer stays on screen while the next one is fetched, so a
    // list does not blink to empty between keystrokes; `isFetching` is what
    // the field's busy state reads (`docs/design/feedback.md`).
    placeholderData: keepPreviousData,
  }
}

export function useSearch(input: SearchInput) {
  const client = useApiClient()
  return useQuery(searchQueryOptions(client, { limit: PALETTE_LIMIT, ...input }))
}

/**
 * Every page, for the results route: keyset paging through `nextCursor`,
 * which also pins the instant the first page was ranked at, so the recency
 * boost cannot shuffle later pages
 * (`docs/architecture/api-contract-m2.md`).
 */
export function searchResultsQueryOptions(client: ApiClient, input: SearchInput) {
  const query = input.query.trim()
  return {
    queryKey: queryKeys.searchResults(input.workspaceId, query),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      fetchPage(client, { limit: RESULTS_LIMIT, ...input }, pageParam),
    initialPageParam: undefined,
    getNextPageParam: (lastPage: SearchResults) => lastPage.nextCursor,
    enabled: query !== '',
  }
}

export function useSearchResults(input: SearchInput) {
  const client = useApiClient()
  return useInfiniteQuery(searchResultsQueryOptions(client, input))
}

/** The three ways a query is refused, so a field can say which and point at it. */
export type InvalidQueryKind = 'unterminated-quote' | 'empty-filter-value' | 'nothing-to-search-for'

export interface InvalidQuery {
  readonly kind: string
  /** The offset into the query the server could not get past. */
  readonly position: number
  readonly message: string
}

function isInvalidQueryDetails(value: unknown): value is { kind: string; position: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof value.kind === 'string' &&
    'position' in value &&
    typeof value.position === 'number'
  )
}

/**
 * `422 invalid_query` as something a search box can draw: which of the three
 * refusals it was, and the character it happened at
 * (`docs/architecture/api-contract-m2.md`). Anything else — a network
 * failure, a 500, a body that does not carry the documented details — reads
 * as `undefined`, and the caller shows its ordinary error state instead.
 */
export function readInvalidQuery(error: unknown): InvalidQuery | undefined {
  if (!(error instanceof ApiError) || error.code !== 'invalid_query') return undefined
  if (!isInvalidQueryDetails(error.details)) return undefined
  return { kind: error.details.kind, position: error.details.position, message: error.message }
}
