/**
 * The search query language: free terms, quoted phrases, `-` exclusions, and
 * field filters (`title:`, `tag:`, `owner:`, `status:`, `collection:`,
 * `in:workspace`). This is the structured form both {@link parseQuery} and
 * {@link serializeQuery} agree on; nothing downstream reads query text again.
 */

/** The field names a filter clause may name. `in` currently only takes `workspace`. */
export const FIELD_FILTER_KEYS = ['title', 'tag', 'owner', 'status', 'collection', 'in'] as const

export type FieldFilterKey = (typeof FIELD_FILTER_KEYS)[number]

export function isFieldFilterKey(value: string): value is FieldFilterKey {
  return (FIELD_FILTER_KEYS as readonly string[]).includes(value)
}

/** A bare word, unquoted, matched against any indexed field. */
export interface TermClause {
  readonly kind: 'term'
  readonly value: string
  readonly negated: boolean
}

/** A quoted span, matched as one exact phrase rather than loose words. */
export interface PhraseClause {
  readonly kind: 'phrase'
  readonly value: string
  readonly negated: boolean
}

/** A `field:value` pair, restricting the match to one indexed property. */
export interface FilterClause {
  readonly kind: 'filter'
  readonly key: FieldFilterKey
  readonly value: string
  readonly negated: boolean
}

export type QueryClause = TermClause | PhraseClause | FilterClause

/**
 * A parsed query, in the order its clauses appeared. Order is kept, not
 * because ranking depends on it, but because it is what {@link serializeQuery}
 * needs to reproduce the author's input byte for byte.
 */
export interface SearchQuery {
  readonly clauses: readonly QueryClause[]
}

export function term(value: string, negated = false): TermClause {
  return { kind: 'term', value, negated }
}

export function phrase(value: string, negated = false): PhraseClause {
  return { kind: 'phrase', value, negated }
}

export function filter(key: FieldFilterKey, value: string, negated = false): FilterClause {
  return { kind: 'filter', key, value, negated }
}
