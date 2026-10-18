import type { FacetValue, SearchFacets, SearchHit, SearchResults } from './types.ts'

/**
 * A search hit as the server sends it, for tests.
 *
 * One builder rather than a literal in every file that fakes `GET /api/search`:
 * the hit has grown fields before (status, contributors, tags) and each growth
 * meant touching every copy. Typed against the generated contract, so a field
 * the server adds is a compile error here and nowhere else. Defaults describe a
 * plain published document with nobody to credit and nothing tagged; a test
 * overrides only what it is about.
 */
export function searchHitFixture(title: string, overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    documentId: `doc-${title}`,
    shortId: 'k7m3q9v2xd',
    slug: 'regional-failover',
    title,
    path: 'runbooks/regional-failover',
    workspaceId: 'ws-1',
    breadcrumb: ['Engineering', 'Runbooks'],
    snippet: { text: 'Follow the failover runbook.', ranges: [{ start: 11, end: 19 }] },
    score: 1,
    status: 'published',
    updatedAt: '2026-10-01T09:30:00.000Z',
    tags: [],
    contributors: [],
    contributorCount: 0,
    ...overrides,
  }
}

/** One facet value; the label defaults to the value, as it does for most tags. */
export function facetValueFixture(value: string, count: number, label: string = value): FacetValue {
  return { value, label, count }
}

/**
 * A search answer as the server sends it, for tests: the hits given, nothing
 * elsewhere, and facets only when a test supplies them (absent is the real
 * "not asked" answer).
 */
export function searchResultsFixture(
  query: string,
  hits: readonly SearchHit[],
  facets?: SearchFacets,
): SearchResults {
  return {
    query,
    current: [...hits],
    elsewhere: [],
    ...(facets === undefined ? {} : { facets }),
  }
}
