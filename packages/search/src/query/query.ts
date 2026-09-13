/**
 * The search query language: free terms, quoted phrases, `-` exclusions, and
 * field filters (`title:`, `tag:`, `owner:`, `status:`, `collection:`,
 * `in:workspace`). This is the structured form both {@link parseQuery} and
 * {@link serializeQuery} agree on; nothing downstream reads query text again.
 *
 * The shapes themselves belong to the search port
 * (`@quill/application`'s `ports/search-index.ts`) and are re-exported here,
 * so this package reads as one module while an adapter still implements a
 * single interface. The import is type-only, so no part of the application
 * layer reaches this package at runtime.
 */

import type {
  FieldFilterKey,
  FilterClause,
  PhraseClause,
  TermClause,
} from '@quill/application/ports'

export type {
  FieldFilterKey,
  FilterClause,
  PhraseClause,
  QueryClause,
  SearchQuery,
  TermClause,
} from '@quill/application/ports'

/**
 * The field names a filter clause may name, as data.
 *
 * `satisfies` pins the two together in both directions: a key added to
 * {@link FieldFilterKey} and not listed here would parse as a plain term, and
 * a key listed here that the type does not have fails to compile.
 */
export const FIELD_FILTER_KEYS = [
  'title',
  'tag',
  'owner',
  'status',
  'collection',
  'in',
] as const satisfies readonly FieldFilterKey[]

export function isFieldFilterKey(value: string): value is FieldFilterKey {
  return (FIELD_FILTER_KEYS as readonly string[]).includes(value)
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
