import { createFileRoute } from '@tanstack/react-router'

import { SearchPage } from '../../../../features/search/search-page.tsx'
import { RouteNotice } from '../../../../features/workspaces/route-notice.tsx'
import {
  queryTooLong,
  searchResultsQueryOptions,
  workspaceQueryOptions,
} from '../../../../lib/api/index.ts'
import { optionalStringSearch } from '../../../-search.ts'

/** The query, as URL state: a search is a place, so it can be linked to and shared (ADR-013). */
export interface SearchRouteSearch {
  q?: string
}

/**
 * The workspace's full search results, inside the shell its layout route
 * already drew.
 *
 * The route lives under the workspace because the workspace is what search is
 * run *from* — it decides what comes back first — even though the answer
 * itself crosses into every other workspace the reader may see (quill-plan.md
 * §15).
 *
 * The loader prefetches rather than awaits: the field, the heading and the
 * shell are worth painting immediately, and the results arrive under the
 * page's own pending state a moment later. It is the same options factory the
 * page's hook reads with, so both share one cache entry (router.tsx, rule 3).
 */
export const Route = createFileRoute('/_authenticated/w/$workspaceSlug/search')({
  validateSearch: (search: Record<string, unknown>): SearchRouteSearch =>
    optionalStringSearch(search, 'q'),
  loaderDeps: ({ search }) => ({ q: search.q ?? '' }),
  loader: async ({ context, params, deps }) => {
    const workspace = await context.queryClient.ensureQueryData(
      workspaceQueryOptions(context.apiClient, params.workspaceSlug),
    )
    // Neither empty nor longer than the route will read: the page says so
    // itself, and prefetching either would only earn a refusal.
    if (deps.q.trim() !== '' && !queryTooLong(deps.q.trim())) {
      void context.queryClient.prefetchInfiniteQuery(
        searchResultsQueryOptions(context.apiClient, {
          query: deps.q,
          workspaceId: workspace.id,
        }),
      )
    }
    return { q: deps.q }
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData?.q === undefined || loaderData.q === '' ? 'Search' : `Search: ${loaderData.q}`,
      },
    ],
  }),
  errorComponent: () => (
    <RouteNotice
      title="Couldn't run that search"
      body="Something went wrong on the way. Reload the page to try again."
    />
  ),
  component: SearchPage,
})
