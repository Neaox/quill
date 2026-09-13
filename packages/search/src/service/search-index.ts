/**
 * The engine boundary ADR-010 describes: "All search goes through a
 * `SearchIndex` interface... in `packages/search`."
 *
 * There is one such interface in the platform and it is declared with the
 * other ports, in `@quill/application`'s `ports/search-index.ts` — see that
 * file for what `search` guarantees about the visibility filter and the
 * ranking profile. It is re-exported here so this package, and an adapter
 * reading it, still find the boundary where ADR-010 says it is.
 */

export type {
  SearchHit,
  SearchHits,
  SearchIndex,
  SearchIndexQueryOptions,
} from '@quill/application/ports'
