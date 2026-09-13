/**
 * Test support: an in-memory `SearchIndex` for exercising `createSearchService`
 * without a real engine. Imported by this package's own tests and by any
 * package that composes a `SearchService` and wants to test that composition
 * without standing up Postgres or Meilisearch.
 */
export type { InMemorySearchIndex, InMemorySearchIndexOptions } from './in-memory-search-index.ts'
export { createInMemorySearchIndex } from './in-memory-search-index.ts'
