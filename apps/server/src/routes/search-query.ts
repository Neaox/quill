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

/** The filters a site open to the world does not answer. */
const PRIVATE_FILTER_KEYS: ReadonlySet<string> = new Set(['by', 'team', 'prop'])

/**
 * Whether a query asks about people or properties: `by:`, `team:` or `prop:`,
 * kept or left out.
 *
 * Who has written what, and what a page's front matter holds beyond the core
 * fields, are not for everyone. A signed-in search answers them — only about
 * documents the caller may read — but a site open to the world must not, or
 * `by:somebody@company.com` would confirm to a stranger that an address is an
 * author of a published page, and `prop:` would let a stranger probe front
 * matter the site never shows. The public route asks this before it asks the
 * engine anything. A query the parser cannot read is not one that asks about
 * either; it is refused for being unreadable, as it always was.
 */
export function searchesPrivateFields(queryText: string): boolean {
  const parsed = parseQuery(queryText)
  return (
    parsed.ok &&
    parsed.value.clauses.some(
      (clause) => clause.kind === 'filter' && PRIVATE_FILTER_KEYS.has(clause.key),
    )
  )
}
