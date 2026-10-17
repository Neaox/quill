import { parseQuery } from '@quill/search/query'
import type { FieldFilterKey } from '@quill/search/query'

import type { FacetName, FacetValue, SearchFacets } from '../../lib/api/index.ts'

/**
 * What a results page can offer to narrow itself, from the counts the server
 * sent and the query that was asked.
 *
 * Pure: the page decides what to do with a choice (`withClause`), this only
 * decides what is worth offering.
 */

/** The facets in the order they are shown, with the filter each one writes. */
export const FACETS: readonly {
  readonly name: FacetName
  readonly label: string
  readonly key: FieldFilterKey
}[] = [
  { name: 'tag', label: 'Tag', key: 'tag' },
  { name: 'status', label: 'Status', key: 'status' },
  { name: 'collection', label: 'Collection', key: 'collection' },
]

export interface RefinementGroup {
  readonly name: FacetName
  readonly label: string
  readonly key: FieldFilterKey
  readonly values: readonly FacetValue[]
}

/** The filters in the query as `key` -> lower-cased values, negated ones included. */
function appliedValues(query: string): ReadonlyMap<string, ReadonlySet<string>> {
  const parsed = parseQuery(query)
  const applied = new Map<string, Set<string>>()
  if (!parsed.ok) return applied
  for (const clause of parsed.value.clauses) {
    if (clause.kind !== 'filter') continue
    const values = applied.get(clause.key) ?? new Set<string>()
    values.add(clause.value.toLowerCase())
    applied.set(clause.key, values)
  }
  return applied
}

/**
 * One group per facet with a value left to offer. A value the query already
 * filters on is left out, including one it rules out (adding it would only
 * contradict the query); a query that cannot be read hides nothing. For tags
 * `tag:area` already covers `area`, so only that exact parent is hidden: the
 * tags beneath it are narrower and still worth offering.
 */
export function refinements(
  facets: SearchFacets | undefined,
  query: string,
): readonly RefinementGroup[] {
  if (facets === undefined) return []
  const applied = appliedValues(query)
  return FACETS.flatMap(({ name, label, key }) => {
    const already = applied.get(key)
    const values = (facets[name] ?? []).filter(
      (candidate) => !already?.has(candidate.value.toLowerCase()),
    )
    return values.length === 0 ? [] : [{ name, label, key, values }]
  })
}
