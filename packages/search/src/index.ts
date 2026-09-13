/**
 * The search core (ADR-010): the query language, the indexable document
 * projection, ranking data, snippet offsets, and the visibility contract
 * every search engine adapter shares. Framework-free — no server, no
 * database driver, no React — so it is usable unchanged by the PostgreSQL
 * full-text adapter first and a Meilisearch or semantic adapter later. See
 * `README.md` for what the core owns versus what an adapter owns.
 */

// Query language
export type {
  FieldFilterKey,
  FilterClause,
  PhraseClause,
  QueryClause,
  SearchQuery,
  TermClause,
} from './query/query.ts'
export { FIELD_FILTER_KEYS, filter, isFieldFilterKey, phrase, term } from './query/query.ts'
export type { QueryParseError } from './query/parse.ts'
export { parseQuery } from './query/parse.ts'
export { serializeQuery } from './query/serialize.ts'

// Indexable document projection
export type {
  IndexableDocument,
  IndexableDocumentV1,
  IndexableHeading,
  UnsupportedIndexableDocumentVersion,
} from './document/indexable-document.ts'
export {
  assertSupportedIndexableDocumentVersion,
  headingWeight,
  INDEXABLE_DOCUMENT_VERSION,
} from './document/indexable-document.ts'
export type { DocumentLocation, ProjectIndexableDocumentInput } from './document/project.ts'
export { projectIndexableDocument } from './document/project.ts'

// Ranking, as data
export type {
  FieldWeights,
  RankingProfile,
  RecencyBoost,
  WorkspaceAffinity,
} from './ranking/ranking-profile.ts'
export { DEFAULT_RANKING_PROFILE, recencyMultiplier } from './ranking/ranking-profile.ts'

// Snippets
export type { Snippet, SnippetOptions, SnippetRange } from './snippet/snippet.ts'
export { buildSnippet } from './snippet/snippet.ts'

// The permission-filter contract
export type { VisibilityFilter } from './visibility/visibility-filter.ts'
export { visibilityFilter } from './visibility/visibility-filter.ts'

// The engine boundary and the composed service
export type {
  SearchHit,
  SearchHits,
  SearchIndex,
  SearchIndexQueryOptions,
} from './service/search-index.ts'
export type { SearchRequest } from './service/search-request.ts'
export type {
  SearchServiceHit,
  SearchServiceResults,
  WorkspaceHits,
} from './service/search-result.ts'
export { groupByWorkspaceAffinity } from './service/group-by-workspace-affinity.ts'
export type { SearchService } from './service/search-service.ts'
export { createSearchService } from './service/search-service.ts'
