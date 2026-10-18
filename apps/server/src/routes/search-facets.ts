import type { FacetCount, FacetCounts, FacetName } from '@quill/application'
import { FACET_NAMES, rankFacetCounts } from '@quill/search'
import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

/**
 * Facets on `GET /api/search` (ADR-010, amendment of 2026-10-17): the counts
 * of what the query matched, by tag, status and collection, so a person can
 * refine it. The engine counts (`SearchIndex.facets`); this turns its counts
 * into the response: it names collections, which the index knows only by id,
 * and counts those that share a name together, because `collection:` matches
 * by name and a count should be what the refinement then returns.
 */

/** The most values a facet lists: a refinement list, not an index of everything. */
export const FACET_VALUE_LIMIT = 8

/** `tag`, `status`, `collection`, comma-separated: anything else is a 400 from validation. */
export const FACETS_PATTERN = `^(${FACET_NAMES.join('|')})(,(${FACET_NAMES.join('|')}))*$`

/** The names a validated `facets` parameter holds, each once, in the order asked. */
export function facetNamesFrom(parameter: string): readonly FacetName[] {
  return [...new Set(parameter.split(','))].filter(isFacetName)
}

function isFacetName(name: string): name is FacetName {
  return (FACET_NAMES as readonly string[]).includes(name)
}

const FacetValueSchema = Type.Object({
  /** What goes after the filter key: `tag:<value>`, `status:<value>`, `collection:<value>`. */
  value: Type.String(),
  /** What a list shows: the tag path, the status, the collection's name. */
  label: Type.String(),
  /** How many documents the query matched that carry it, over all of them and not only the page. */
  count: Type.Integer({ minimum: 1 }),
})

export const FacetsSchema = Type.Object({
  tag: Type.Optional(Type.Array(FacetValueSchema)),
  status: Type.Optional(Type.Array(FacetValueSchema)),
  collection: Type.Optional(Type.Array(FacetValueSchema)),
})

export type FacetsResponse = Static<typeof FacetsSchema>

/**
 * The engine's counts as the response. `collectionNames` maps the collection
 * ids in `counts.collection` to their names, from one lookup for all of them;
 * an id with no name (the collection was deleted since) is dropped.
 */
export function toFacetsResponse(
  counts: FacetCounts,
  collectionNames: ReadonlyMap<string, string>,
  limit: number,
): FacetsResponse {
  return {
    ...(counts.tag === undefined ? {} : { tag: labelled(counts.tag) }),
    ...(counts.status === undefined ? {} : { status: labelled(counts.status) }),
    ...(counts.collection === undefined
      ? {}
      : { collection: labelled(byName(counts.collection, collectionNames, limit)) }),
  }
}

function labelled(counts: readonly FacetCount[]): NonNullable<FacetsResponse['tag']> {
  return counts.map(({ value, count }) => ({ value, label: value, count }))
}

/**
 * Collections counted under their name, case-insensitively as `collection:`
 * matches, and ranked after the merge: a name that two collections share is
 * one value whose count is every document in either. It is shown as the first
 * spelling met, which is the one with most documents.
 */
function byName(
  counts: readonly FacetCount[],
  names: ReadonlyMap<string, string>,
  limit: number,
): readonly FacetCount[] {
  const merged = new Map<string, { readonly name: string; readonly count: number }>()
  for (const { value: id, count } of counts) {
    const name = names.get(id)
    if (name === undefined) continue
    const key = name.toLowerCase()
    const existing = merged.get(key)
    merged.set(key, { name: existing?.name ?? name, count: (existing?.count ?? 0) + count })
  }
  return rankFacetCounts(
    new Map([...merged.values()].map(({ name, count }) => [name, count])),
    limit,
  )
}
