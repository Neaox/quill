import type { DocumentId, WorkspaceId } from '@quill/domain'

import type { IndexableDocument } from '../document/indexable-document.ts'
import type { SearchQuery } from '../query/query.ts'
import type { RankingProfile } from '../ranking/ranking-profile.ts'
import type { VisibilityFilter } from '../visibility/visibility-filter.ts'

/** One matching document, scored and still carrying its raw body so a snippet can be built from it. */
export interface SearchHit {
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
  readonly title: string
  readonly body: string
  readonly score: number
}

export interface SearchHits {
  /** Relevance order, highest score first: `groupByWorkspaceAffinity` (../service/group-by-workspace-affinity.ts) relies on it to order each workspace's group. */
  readonly hits: readonly SearchHit[]
  readonly nextCursor?: string
}

export interface SearchIndexQueryOptions {
  readonly limit: number
  readonly cursor?: string

  /**
   * The workspace the caller is currently in, so the engine can apply
   * `RankingProfile.workspaceAffinity.currentWorkspaceBoost` while it picks
   * the top matches — the boost has to happen before the cutoff, not after,
   * or a current-workspace document just outside the top `limit` never gets
   * the chance `groupByWorkspaceAffinity` would otherwise give it.
   */
  readonly currentWorkspaceId?: WorkspaceId
}

/**
 * The engine boundary ADR-010 describes: "All search goes through a
 * `SearchIndex` interface... in `packages/search`." PostgreSQL full-text
 * search implements it first; Meilisearch or a semantic index implement it
 * later, without a redesign.
 *
 * This is *not* `@quill/application`'s `SearchIndex` port
 * (`packages/application/src/ports/search-index.ts`) — see the package
 * README for why the two currently differ and what the application port
 * would need to grow to be implemented directly in terms of this one. This
 * interface takes the parsed query, the mandatory visibility filter, and the
 * full ranking profile, and hands back scored hits that still carry their
 * body text, which is what lets `createSearchService` build a snippet from
 * the real match rather than trusting the adapter to have rendered one.
 *
 * `search` applies `filter` *inside* the query (ADR-012): a hit a principal
 * cannot see must never be counted, cursor-paged past, or otherwise
 * observable, so an adapter joins the permission table rather than fetching
 * everything and discarding what does not pass.
 */
export interface SearchIndex {
  index(doc: IndexableDocument): Promise<void>
  remove(documentId: DocumentId): Promise<void>
  search(
    query: SearchQuery,
    filter: VisibilityFilter,
    profile: RankingProfile,
    options: SearchIndexQueryOptions,
  ): Promise<SearchHits>
}
