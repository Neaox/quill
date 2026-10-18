import type {
  CollectionId,
  DocumentId,
  DocumentStatus,
  LifecycleState,
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

/**
 * The field names a filter clause may name. `in` currently only takes `workspace`.
 *
 * `by` is a person who has published a revision of the document (a name, an
 * email, or `me`), and `team` is a group or unit whose members have; the
 * engine resolves both against what it knows, as it resolves `collection` and
 * `in`, and neither is available to a caller who is not signed in.
 *
 * `tag` is hierarchical (`/` separates a tag from its parent): `tag:area`
 * finds a document tagged `area` or anything beneath it. `prop` is `key=value`
 * over the front-matter keys that are not core fields; it is available to
 * signed-in callers only, like `by` and `team`.
 */
export type FieldFilterKey =
  | 'title'
  | 'tag'
  | 'owner'
  | 'status'
  | 'collection'
  | 'in'
  | 'by'
  | 'team'
  | 'prop'

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
  /**
   * The legacy publication status a `status:` filter matches: a value from
   * before the lifecycle existed, or `published` when the front matter has
   * none. Never a lifecycle state; that travels as {@link lifecycle}.
   */
  readonly status: DocumentStatus
  readonly updatedAt: Date
  /**
   * The author's lifecycle (ADR-005 amendment of 2026-10-17): in review,
   * verified or deprecated, or undefined when the front matter sets none.
   * Only `deprecated` affects ranking today ({@link RankingProfile.deprecatedPenalty}).
   * Optional, so a projection written before it existed still reads; that is
   * why `INDEXABLE_DOCUMENT_VERSION` did not change for it.
   */
  readonly lifecycle?: LifecycleState | undefined
  /**
   * What the document is about in a sentence or two — its `description`, or
   * its first paragraph — for lists that show it under its title (ADR-058).
   * Optional, so a projection written before it existed still reads.
   */
  readonly summary?: string | undefined
  /** The document's own icon, an emoji from its front matter (ADR-058). */
  readonly icon?: string | undefined
}

/**
 * Someone who has published a revision of a document, as the revision recorded
 * them: the name and address they published under, not an account. A person
 * who published through Git sync has no account here and is still findable,
 * and one who has left is still named on what they wrote.
 */
export interface Contributor {
  readonly name: string
  /** Lower case and trimmed: it is what `by:` and `team:` match exactly. */
  readonly email: string
}

/**
 * Version 2 adds who has published (`by:` and `team:`). Version 1 documents
 * are still read as they were written (rule 17): a row indexed before this
 * carries no contributors until it is next published or `quill reindex` runs.
 */
export interface IndexableDocumentV2 extends Omit<IndexableDocumentV1, 'version'> {
  readonly version: 2
  readonly contributors: readonly Contributor[]
}

/**
 * Version 3 adds the generic properties (`prop:key=value`): the front-matter
 * keys that are not core fields, folded and bounded by `extractProperties`
 * (`@quill/search`). Versions 1 and 2 are still read as they were written
 * (rule 17): a row carries no properties until it is next published or
 * `quill reindex` runs, because they live in the content store and cannot be
 * derived by a migration.
 */
export interface IndexableDocumentV3 extends Omit<IndexableDocumentV2, 'version'> {
  readonly version: 3
  /** Lower-case key to its lower-case values; absent keys have none. */
  readonly properties: Readonly<Record<string, readonly string[]>>
}

export type IndexableDocument = IndexableDocumentV3

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
  /**
   * Multiplier applied to a deprecated document's score: below 1, so a
   * deprecated page still appears but below a current one that matched as
   * well.
   */
  readonly deprecatedPenalty: number
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

/**
 * One caller's visibility, shared by the calls a single request makes
 * (ADR-010, amendment of 2026-10-17).
 *
 * Working out which documents a caller may read is the expensive part of a
 * query, and a request that asks for a page and its facet counts asks it twice.
 * Passing the same `SharedVisibility` as `visibility` to `search` and `facets`
 * lets an adapter answer once: it keeps what it resolved against this object
 * and reuses it, including while the two calls are in flight together.
 *
 * It carries the {@link VisibilityFilter} it was made for and an adapter uses
 * it only for a call made with that very filter, so a handle can never widen
 * (or narrow) the visibility of a different caller. It lives for one request:
 * the answer is never kept past it, because permissions change and a stale
 * one would show somebody a document that was just taken away from them.
 */
export interface SharedVisibility {
  readonly filter: VisibilityFilter
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
  /** The tags the document was indexed with, folded to lower case, in the order they were written. */
  readonly tags: readonly string[]
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

  /** Resolve the caller's visibility once with `facets`, if the request asks for both: see {@link SharedVisibility}. */
  readonly visibility?: SharedVisibility
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
 *
 * `suggest` completes a filter's value as somebody types it (ADR-010,
 * amendment of 2026-10-17). It takes the same `filter` and applies it the same
 * way, inside the query, so a name or a tag that appears only on a document the
 * caller may not read is never offered: a suggestion is a search result with
 * the document left off, and obeys the same rule. Values come back ordered by
 * relevance (prefix matches first, then other substring matches, alphabetical
 * within each), case-insensitively de-duplicated, at most `limit` of them.
 *
 * `facets` counts what the query matches, for people to refine it with. It takes
 * the same `filter` and applies it inside the query, so a document the caller
 * may not read contributes to no count: a count is a search result with the
 * document left off. The match is the strict one (every word has to appear):
 * the OR widening `search` falls back on when it finds too little is not
 * counted, because a facet describes the results somebody asked for, and a
 * refinement is only useful if its count is what the refinement then returns.
 * Each count is over the whole matching set, not the page a client has seen.
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
  suggest(request: SuggestionRequest, filter: VisibilityFilter): Promise<readonly string[]>
  facets(query: SearchQuery, filter: VisibilityFilter, options: FacetsOptions): Promise<FacetCounts>
}

/** The facets a search can count (ADR-010, amendment of 2026-10-17). */
export type FacetName = 'tag' | 'status' | 'collection'

/** One value of a facet and how many matching documents carry it. */
export interface FacetCount {
  /**
   * A tag path (`area/billing`), a status, or a collection id: the engine
   * knows collections by id, and it is the application that names them (and
   * merges collections that share a name).
   */
  readonly value: string
  readonly count: number
}

export type FacetCounts = Readonly<Partial<Record<FacetName, readonly FacetCount[]>>>

export interface FacetsOptions {
  /** Which facets to count: nothing is counted that is not named. */
  readonly facets: readonly FacetName[]
  /**
   * The most values of `tag` and `status` to return, by count (largest
   * first) and then by value in code-point order. `collection` is returned
   * whole, because the application merges collections that share a name
   * before it chooses the top values.
   */
  readonly limit: number
  /**
   * The workspace the caller is in, so that facets and the page agree on the
   * order workspaces are resolved in and can share it: it changes the order of
   * the walk, never the counts.
   */
  readonly currentWorkspaceId?: WorkspaceId
  /** Resolve the caller's visibility once with `search`, if the request asks for both: see {@link SharedVisibility}. */
  readonly visibility?: SharedVisibility
}

/**
 * The filters whose values the index itself knows: the names of the accounts
 * that have published a document the caller may read, and the tags those
 * documents carry. The other filters complete from tables the index does not
 * own (workspaces, collections, groups) and are answered by the application.
 */
export type IndexedSuggestionField = 'by' | 'tag'

export interface SuggestionRequest {
  readonly field: IndexedSuggestionField
  /** Matched as a case-insensitive substring; empty matches everything. */
  readonly prefix: string
  readonly limit: number
  /** Resolved first, as for a search, so the values from where the caller is looking are found first. */
  readonly currentWorkspaceId?: WorkspaceId
}
