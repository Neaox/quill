import { compareCodePoints } from '@quill/domain'

import type { FacetCount, FacetName } from '../service/search-index.ts'

/**
 * Facets (ADR-010, amendment of 2026-10-17): the counts of what a query
 * matched, offered so a person can refine it. These are the pieces every
 * implementation of the counting shares, so the PostgreSQL adapter, the
 * in-memory double and the route that names collections can never disagree
 * about which values come first.
 */

/** The facets a search can count, in the order a response lists them. */
export const FACET_NAMES = ['tag', 'status', 'collection'] as const satisfies readonly FacetName[]

/** Adds `entries` to `into`, summing a value that is already there: how counts from separate batches of workspaces merge. */
export function addCounts(into: Map<string, number>, entries: Iterable<FacetCount>): void {
  for (const { value, count } of entries) {
    into.set(value, (into.get(value) ?? 0) + count)
  }
}

/**
 * The `limit` values with the most documents: by count, largest first, then by
 * value in code-point order (not locale order, so the list is the same on
 * every host and in every engine).
 */
export function rankFacetCounts(
  counts: ReadonlyMap<string, number>,
  limit: number,
): readonly FacetCount[] {
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .toSorted(
      (left, right) => right.count - left.count || compareCodePoints(left.value, right.value),
    )
    .slice(0, limit)
}
