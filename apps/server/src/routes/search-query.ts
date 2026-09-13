import { parseQuery } from '@quill/search'
import type { QueryParseError } from '@quill/search'

/**
 * Whether a piece of text is a search at all.
 *
 * A query is a search when it names something to find: a word, a phrase, or a
 * field filter. One that names only exclusions — `-draft` — is an enumeration
 * of everything the caller may read with a few things missing, and so is one
 * whose every clause the parser dropped.
 *
 * The rule lives here rather than in either route because both surfaces need
 * it and they answer differently: `/api/search` refuses with `422` and the
 * position the parser stopped at, while the public site renders its ordinary
 * "nothing matched" page — a stranger typing into a search box is not owed an
 * error page. Two routes, one reading of the language (ADR-010).
 */

export type UnsearchableQuery =
  | { readonly kind: 'unparsed'; readonly error: QueryParseError }
  | { readonly kind: 'nothing-to-search-for' }

/** Null when the text is a search; otherwise why it is not one. */
export function unsearchable(queryText: string): UnsearchableQuery | null {
  const parsed = parseQuery(queryText)
  if (!parsed.ok) return { kind: 'unparsed', error: parsed.error }
  return parsed.value.clauses.some((clause) => !clause.negated)
    ? null
    : { kind: 'nothing-to-search-for' }
}
