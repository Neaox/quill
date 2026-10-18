/**
 * One completion for a filter's value: `value` is what goes after `field:`
 * (the web quotes it when it needs to) and `label` is what the list shows.
 */
export interface SearchSuggestion {
  readonly value: string
  readonly label: string
}

/** A suggestion whose list label is its value, which is every field but a few. */
export function suggestion(value: string): SearchSuggestion {
  return { value, label: value }
}

/**
 * Orders candidate completions the way every field does (ADR-010, amendment of
 * 2026-10-17), whatever it was gathered from: labels that start with what was
 * typed first, then labels that merely contain it, alphabetical within each,
 * case-insensitive, de-duplicated by value (the first of two that differ only
 * in case wins, so candidates arrive in the order they are preferred), at most
 * `limit` of them.
 *
 * One function rather than one per source, so the search adapter, the
 * in-memory double and the application's own sources can never disagree about
 * what "relevance" means.
 */
export function rankSuggestions(
  candidates: Iterable<SearchSuggestion>,
  prefix: string,
  limit: number,
): readonly SearchSuggestion[] {
  const needle = prefix.trim().toLowerCase()
  const distinct = new Map<string, SearchSuggestion>()
  for (const candidate of candidates) {
    const key = candidate.value.toLowerCase()
    if (!distinct.has(key) && candidate.label.toLowerCase().includes(needle)) {
      distinct.set(key, candidate)
    }
  }

  const ranked = [...distinct.values()].map((candidate) => ({
    candidate,
    folded: candidate.label.toLowerCase(),
  }))
  return ranked
    .toSorted(
      (left, right) =>
        Number(!left.folded.startsWith(needle)) - Number(!right.folded.startsWith(needle)) ||
        compareCodePoints(left.folded, right.folded) ||
        compareCodePoints(left.candidate.value, right.candidate.value),
    )
    .slice(0, limit)
    .map(({ candidate }) => candidate)
}

/** Code-point order, not locale order: the same list on every host. */
export function compareCodePoints(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}
