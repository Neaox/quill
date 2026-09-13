import type {
  CollectionId,
  DocumentId,
  DocumentStatus,
  RevisionId,
  WorkspaceId,
} from '@quill/domain'

/**
 * The search port (ADR-010, quill-plan.md §15).
 *
 * There is one `SearchIndex` in the platform and this is it. `@quill/search`
 * — the engine-agnostic core that parses the query language, projects a
 * published document into {@link IndexableDocument}, builds snippets, and
 * composes the whole pipeline — re-exports these declarations rather than
 * keeping a second, richer set of its own, so an adapter implements one
 * interface and the two can no longer drift. The types are declared here
 * because a port belongs to the layer that depends on it (`ARCHITECTURE.md`:
 * the application layer may depend on "the interfaces it declares"), while
 * every *value* that reads or produces them — `parseQuery`,
 * `projectIndexableDocument`, `DEFAULT_RANKING_PROFILE`, `buildSnippet`,
 * `createSearchService` — stays in `@quill/search`, which is why this file
 * has no imports beyond the domain and why `@quill/search` imports nothing
 * from here at runtime.
 *
 * PostgreSQL full-text search implements it first
 * (`apps/server/src/infrastructure/search`); Meilisearch or a semantic index
 * implement it later, without a redesign.
 */

// ---------------------------------------------------------------------------
// The query language
// ---------------------------------------------------------------------------

/** The field names a filter clause may name. `in` currently only takes `workspace`. */
export type FieldFilterKey = 'title' | 'tag' | 'owner' | 'status' | 'collection' | 'in'

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
 * because ranking depends on it, but because it is what `serializeQuery`
 * needs to reproduce the author's input byte for byte.
 */
export interface SearchQuery {
  readonly clauses: readonly QueryClause[]
}

// ---------------------------------------------------------------------------
// What an adapter indexes
// ---------------------------------------------------------------------------

/** One heading, weighted by depth so a title outranks a subsection (ADR-010). */
export interface IndexableHeading {
  readonly text: string
  readonly depth: number
  readonly weight: number
}

/**
 * What a search engine adapter indexes for one published document. `version`
 * follows rule 17: a value of this shape carries it, and
 * `assertSupportedIndexableDocumentVersion` (`@quill/search`) is where a
 * reader dispatches on it.
 */
export interface IndexableDocumentV1 {
  readonly version: 1
  readonly documentId: DocumentId
  /**
   * The revision this projection was made from, so an index row records what
   * it was derived from and a rebuild can be incremental (ADR-034). It travels
   * with the projection rather than being read from the document's row at
   * write time, because by then the head may already be a later publish and
   * the row would claim a revision it does not hold.
   */
  readonly revision: RevisionId
  readonly workspaceId: WorkspaceId
  readonly collectionId: CollectionId | null
  readonly path: string
  readonly title: string
  readonly headings: readonly IndexableHeading[]
  readonly body: string
  readonly tags: readonly string[]
  readonly owners: readonly string[]
  readonly status: DocumentStatus
  readonly updatedAt: Date
}

export type IndexableDocument = IndexableDocumentV1

// ---------------------------------------------------------------------------
// Ranking, as data
// ---------------------------------------------------------------------------

/** How much a match in each field contributes, relative to the others. */
export interface FieldWeights {
  readonly title: number
  readonly headings: number
  readonly body: number
}

/** How a document's age affects its score: a multiplier that decays toward 1 (no boost) as the document gets older. */
export interface RecencyBoost {
  /** Days for the boost to fall to half its value. */
  readonly halfLifeDays: number
  /** The most a freshly updated document's score can be multiplied up by. */
  readonly maxBoost: number
}

/**
 * How search results favour the workspace the caller is currently in
 * (quill-plan.md §15): search is the one surface that crosses workspaces, so
 * a match in the current workspace outranks an equally relevant match
 * elsewhere, and matches elsewhere are offered as grouped suggestions rather
 * than interleaved into one list.
 */
export interface WorkspaceAffinity {
  /** Multiplier an adapter applies to a hit's score when it is in the caller's current workspace. */
  readonly currentWorkspaceBoost: number
  /** Whether matches outside the current workspace are grouped by workspace rather than left flat. */
  readonly groupOthersByWorkspace: boolean
}

/**
 * Ranking as data: every adapter reads the same profile and translates it
 * into its own engine's scoring — a `tsvector` weight letter for Postgres, a
 * ranking rule for Meilisearch — rather than each adapter inventing its own
 * notion of "title matters more than body". `DEFAULT_RANKING_PROFILE` in
 * `@quill/search` is the one place the numbers live.
 */
export interface RankingProfile {
  readonly fieldWeights: FieldWeights
  readonly recencyBoost: RecencyBoost
  /** Multiplier applied when the query matched an exact quoted phrase rather than loose terms. */
  readonly exactPhraseBoost: number
  readonly workspaceAffinity: WorkspaceAffinity
}

// ---------------------------------------------------------------------------
// Who is searching
// ---------------------------------------------------------------------------

/**
 * Who is searching, and which workspaces the query may even consider
 * (ADR-010, ADR-012).
 *
 * Search is the one surface that crosses workspaces, so `workspaceIds` is the
 * *set* of every workspace the caller may read at all, not the one they are
 * currently in — that one travels separately, on
 * {@link SearchIndexQueryOptions.currentWorkspaceId}, because it changes what
 * is preferred, not what is visible. `principalKeys` uses the same stable key
 * `principalKey` produces for a grant, so a filter can be built directly from
 * the principals a request already resolved.
 *
 * An adapter applies this *inside* the index query — never by fetching
 * unfiltered hits and discarding the ones a principal cannot see — because a
 * document the principal cannot read must never surface, not even in a total
 * count or a cursor.
 */
export interface VisibilityFilter {
  readonly workspaceIds: readonly WorkspaceId[]
  readonly principalKeys: readonly string[]
}

// ---------------------------------------------------------------------------
// The engine boundary
// ---------------------------------------------------------------------------

/** One matching document, scored and still carrying its raw body so a snippet can be built from it. */
export interface SearchHit {
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
  readonly title: string
  readonly body: string
  readonly score: number
}

export interface SearchHits {
  /** Relevance order, highest score first: `groupByWorkspaceAffinity` relies on it to order each workspace's group. */
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
 * `SearchIndex` interface... in `packages/search`."
 *
 * `search` takes the parsed query, the mandatory visibility filter, and the
 * full ranking profile, and hands back scored hits that still carry their
 * body text, which is what lets `createSearchService` build a snippet from
 * the real match rather than trusting the adapter to have rendered one. It
 * applies `filter` *inside* the query (ADR-012): a hit a principal cannot see
 * must never be counted, cursor-paged past, or otherwise observable, so an
 * adapter restricts the query itself rather than fetching everything and
 * discarding what does not pass.
 *
 * The method is named `search`, not `query` as ADR-010's interface sketch
 * shows, because it returns already-scored hits rather than a bag of results
 * to score — a naming choice, not a contradiction of the decision.
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
