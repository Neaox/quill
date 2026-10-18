/**
 * The query language on its own: what a browser needs to read and write a
 * search (chips, typeahead) without taking the rest of the package, whose
 * projection pulls in the whole Markdown pipeline.
 */
export { parseQuery } from './parse.ts'
export type { QueryParseError } from './parse.ts'
export { serializeQuery } from './serialize.ts'
export { parsePropertyFilter } from './property-filter.ts'
export type { PropertyFilter } from './property-filter.ts'
export { FIELD_FILTER_KEYS, isFieldFilterKey } from './query.ts'
export type {
  FieldFilterKey,
  FilterClause,
  PhraseClause,
  QueryClause,
  SearchQuery,
  TermClause,
} from './query.ts'
