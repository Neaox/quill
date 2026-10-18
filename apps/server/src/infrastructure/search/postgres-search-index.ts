import type {
  Clock,
  FacetCounts,
  FacetName,
  FacetsOptions,
  IndexableDocument,
  RankingProfile,
  SearchHit,
  SearchHits,
  SearchIndex,
  SearchIndexQueryOptions,
  SearchQuery,
  SharedVisibility,
  SuggestionRequest,
  VisibilityFilter,
} from '@quill/application'
import { rankSuggestions, suggestion } from '@quill/domain'
import type { DocumentId, WorkspaceId } from '@quill/domain'
import { addCounts, rankFacetCounts } from '@quill/search'
import { eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { documentSearch } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'
import { decodeSearchCursor, encodeSearchCursor } from './cursor.ts'
import type { SearchArm, SearchCursor } from './cursor.ts'
import { toIndexRow } from './index-entry.ts'
import { translateQuery } from './query-sql.ts'
import type { Asker, TranslatedQuery } from './query-sql.ts'
import { principalsFromKeys } from './visible-documents.ts'
import type {
  VisibleDocumentRequest,
  VisibleDocumentResolver,
  VisibleDocuments,
  VisibleDocumentsBatch,
} from './visible-documents.ts'

/**
 * PostgreSQL full-text search behind the `SearchIndex` port (ADR-010,
 * quill-plan.md §15) — the first engine, and the one a self-hoster gets
 * without running a second service. `README.md` in this directory is the
 * long version; four things are worth knowing before reading the SQL.
 *
 * **Permission filtering happens inside the query.** The `VisibilityFilter`
 * becomes a `WHERE` clause over the workspaces the caller may read and the
 * documents within them they may see (`visible-documents.ts` resolves the
 * second through the domain's own materialise-and-combine, a bounded number
 * of workspaces at a time). Nothing is fetched and then discarded, so a
 * document a principal cannot read is never scored, never counted, and never
 * paged past. The walk is the dearest part of a query, so a request that asks
 * for a page and its facets passes one {@link SharedVisibility} to both and the
 * walk of each batch runs once (see {@link batchResolver}).
 *
 * **The match is AND first, widened to OR only when the AND finds too
 * little.** Every word the author typed has to appear, which is precise and
 * cheap; if that yields fewer than {@link WIDEN_BELOW_HITS} documents the
 * query runs again with the words ORed, and the incident at three in the
 * morning still finds its runbook from a half-remembered phrase. The cursor
 * records which arm a page came from, because the two score the same document
 * differently.
 *
 * **Typo tolerance is a separate arm, and never widens past a phrase.** A
 * trigram-similar title is unioned in through its own GIN index rather than
 * being ORed into the full-text predicate, where it would defeat both
 * indexes. A quoted phrase is an exact demand, so no fuzzy arm runs beside
 * one.
 *
 * **Ranking is the `RankingProfile`, translated.** Field weights become
 * `ts_rank_cd`'s weight array against the A/B/C columns the schema generates;
 * the recency curve, the exact-phrase boost, the current-workspace boost and
 * trigram similarity become terms on the rank. No number about what matters
 * more is invented here — `DEFAULT_RANKING_PROFILE` is where they live and R9
 * is what may change them.
 */

export interface PostgresSearchIndexDependencies {
  readonly db: DrizzleClient
  readonly visibility: VisibleDocumentResolver
  readonly clock: Clock
  /**
   * Whether `pg_trgm` is usable, for the typo tolerance ADR-010 asks for.
   * Probed once and remembered for the lifetime of the process when not
   * given: an extension is not installed and uninstalled under a running
   * server, and asking on every search would be a round trip for an answer
   * that never changes. A probe that *fails* is not remembered, so a database
   * that was briefly unreachable is asked again.
   */
  readonly trigram?: () => Promise<boolean>
}

/** How alike a title and a misspelled query must be before the title counts as a match. */
const TRIGRAM_THRESHOLD = 0.3

/**
 * Below this many matches, the AND-ed query is treated as having found too
 * little and the search runs again with the words ORed.
 *
 * One screenful. Above it there is plenty to read and precision is the better
 * answer; below it the author is looking at an almost-empty page and would
 * rather see near misses than nothing.
 */
export const WIDEN_BELOW_HITS = 20

/** `ts_rank_cd` normalisation 32: `rank / (rank + 1)`, so a score is always between 0 and 1 and pages compare cleanly. */
const RANK_NORMALISATION = 32

/** Enough of a long body for `buildSnippet` to trim a sentence out of, and no more. */
const HEADLINE_OPTIONS = 'StartSel="", StopSel="", MaxFragments=1, MaxWords=60, MinWords=25'

/** What a body-less query shows instead: the opening of the document. */
const BODY_PREVIEW_CHARACTERS = 400

/**
 * The most body text one row may carry once PostgreSQL has refused the whole
 * of it.
 *
 * A generated `tsvector` may not exceed a megabyte, and a pathologically
 * token-dense document can reach that. Two hundred thousand bytes is far
 * beyond any document somebody wrote and far short of the limit however
 * dense it is, so the retry succeeds and the document stays findable — which
 * is better than an outbox event that fails until it dead-letters and a
 * document nobody can find.
 */
const MAX_INDEXED_BODY_BYTES = 200_000

/** `program_limit_exceeded`: what PostgreSQL answers when the `tsvector` is too large. */
const PROGRAM_LIMIT_EXCEEDED = '54000'

interface HitRecord extends Record<string, unknown> {
  document_id: string
  workspace_id: string
  title: string
  body: string
  tags: string[]
  score: number
}

export function createPostgresSearchIndex(deps: PostgresSearchIndexDependencies): SearchIndex {
  const trigramAvailable = memoise(deps.trigram ?? (() => probeTrigram(deps.db)))
  const resolveBatch = batchResolver(deps.visibility)

  async function upsert(document: IndexableDocument, bodyByteLimit?: number): Promise<void> {
    const values = toIndexRow({
      document,
      indexedAt: deps.clock.now(),
      ...(bodyByteLimit === undefined ? {} : { bodyByteLimit }),
    })
    await deps.db
      .insert(documentSearch)
      .values(values)
      .onConflictDoUpdate({ target: documentSearch.documentId, set: values })
  }

  return {
    async index(document: IndexableDocument): Promise<void> {
      try {
        await upsert(document)
      } catch (error) {
        if (!isProgramLimitExceeded(error)) throw error
        // The body was too token-dense for a `tsvector`. Index as much of it
        // as certainly fits rather than failing the publish's event for ever:
        // a document findable by its title and most of its body beats one
        // that is not findable at all.
        await upsert(document, MAX_INDEXED_BODY_BYTES)
      }
    },

    async remove(documentId: DocumentId): Promise<void> {
      await deps.db.delete(documentSearch).where(eq(documentSearch.documentId, documentId))
    },

    async search(
      query: SearchQuery,
      filter: VisibilityFilter,
      profile: RankingProfile,
      options: SearchIndexQueryOptions,
    ): Promise<SearchHits> {
      if (filter.workspaceIds.length === 0) return { hits: [] }

      const cursor = options.cursor === undefined ? null : decodeSearchCursor(options.cursor)
      const batch = await resolveBatch(
        {
          filter,
          ...(options.currentWorkspaceId === undefined
            ? {}
            : { currentWorkspaceId: options.currentWorkspaceId }),
          from: cursor?.from ?? 0,
        },
        options.visibility,
      )
      if (batch.workspaceIds.length === 0) return { hits: [] }

      const translated = translateQuery(query, askerOf(filter))
      const scoredAt = cursor === null ? deps.clock.now() : new Date(cursor.at)
      // A quoted phrase is an exact demand: nothing fuzzy may bring in a
      // document that does not contain it (the negative test in
      // `postgres-search-index.integration.test.ts` pins this).
      const trigram =
        translated.text.length > 0 && !translated.hasPhrase && (await trigramAvailable())

      const plan: QueryPlan = {
        translated,
        profile,
        scoredAt,
        trigram,
        batch,
        filter,
        ...(options.currentWorkspaceId === undefined
          ? {}
          : { currentWorkspaceId: options.currentWorkspaceId }),
      }

      const { rows, arm } = await runArms(deps, plan, cursor, options.limit)

      const page = rows.slice(0, options.limit)
      const hits = page.map(toHit)
      const last = page.at(-1)

      return {
        hits,
        ...nextCursorFor({
          more: rows.length > options.limit,
          last,
          arm,
          from: batch.nextFrom,
          batchStart: cursor?.from ?? 0,
          at: scoredAt.toISOString(),
        }),
      }
    },

    async suggest(
      request: SuggestionRequest,
      filter: VisibilityFilter,
    ): Promise<readonly string[]> {
      return suggestValues(deps, request, filter)
    },

    async facets(
      query: SearchQuery,
      filter: VisibilityFilter,
      options: FacetsOptions,
    ): Promise<FacetCounts> {
      return countFacets({ deps, resolveBatch, trigramAvailable }, query, filter, options)
    },
  }
}

/**
 * Completes a filter's value from the documents the caller may read (ADR-010,
 * amendment of 2026-10-17).
 *
 * It walks the same visibility batches a search does — the workspace the
 * caller is in first, then five at a time — and applies each batch's
 * permission predicate inside the statement, so a name or a tag that is only
 * on a document the caller is denied is never selected, let alone returned.
 * It stops as soon as the limit is filled, so the common case costs one walk;
 * the values from a later batch can then rank below ones already found, which
 * is the same trade search makes and for the same reason (a bounded cost per
 * keystroke).
 */
async function suggestValues(
  deps: PostgresSearchIndexDependencies,
  request: SuggestionRequest,
  filter: VisibilityFilter,
): Promise<readonly string[]> {
  const found = new Map<string, string>()
  let ranked: readonly string[] = []
  let from: number | null = 0

  while (from !== null) {
    const batch = await deps.visibility.resolve({
      filter,
      ...(request.currentWorkspaceId === undefined
        ? {}
        : { currentWorkspaceId: request.currentWorkspaceId }),
      from,
    })
    if (batch.workspaceIds.length === 0) break

    const { rows } = await deps.db.execute<{ value: string }>(suggestionQuery(request, batch))
    for (const row of rows) found.set(row.value.toLowerCase(), row.value)
    ranked = rankSuggestions(
      [...found.values()].map(suggestion),
      request.prefix,
      request.limit,
    ).map((candidate) => candidate.value)
    from = ranked.length >= request.limit ? null : batch.nextFrom
  }
  return ranked
}

/**
 * The distinct values of one field over one batch, best first, at most
 * `limit`.
 *
 * What was typed is a bound parameter inside a `LIKE` pattern with `%`, `_`
 * and `\` escaped, so it can only ever be text. Tags are stored folded to
 * lower case; people are the accounts whose address is among the contributors
 * of a document the caller may read, so a Git-synced author with no account
 * is not named, and an address is never selected — nor is a display name
 * that is itself an address, which would be one by another route.
 */
function suggestionQuery(request: SuggestionRequest, batch: VisibleDocumentsBatch): SQL {
  const needle = request.prefix
    .trim()
    .toLowerCase()
    .replace(/[\\%_]/gu, '\\$&')
  const contains = `%${needle}%`
  const startsWith = `${needle}%`
  const visible = allOf(visibilityPredicates(batch.visible, batch.workspaceIds))

  const distinctValues =
    request.field === 'tag'
      ? // Every node of the hierarchy, so `area` is offered beside `area/billing`.
        sql`SELECT DISTINCT tag AS value FROM ${documentSearch}, unnest(${documentSearch.tagPaths}) AS tag WHERE ${visible}`
      : sql`SELECT DISTINCT ON (lower(u.display_name)) u.display_name AS value
          FROM users u
          WHERE u.display_name NOT LIKE '%@%' AND lower(trim(u.email)) IN (
            SELECT DISTINCT unnest(${documentSearch.contributorEmails}) FROM ${documentSearch} WHERE ${visible}
          )
          ORDER BY lower(u.display_name), u.display_name`

  return sql`
    SELECT value FROM (${distinctValues}) AS distinct_values
    WHERE lower(value) LIKE ${contains} ESCAPE '\\'
    ORDER BY (lower(value) NOT LIKE ${startsWith} ESCAPE '\\'), lower(value), value
    LIMIT ${request.limit}::int
  `
}

/** What counting facets needs besides the query: the database, the walk, and whether typos are tolerated. */
interface FacetCollaborators {
  readonly deps: PostgresSearchIndexDependencies
  readonly resolveBatch: BatchResolver
  readonly trigramAvailable: () => Promise<boolean>
}

type BatchResolver = (
  request: VisibleDocumentRequest,
  shared: SharedVisibility | undefined,
) => Promise<VisibleDocumentsBatch>

/**
 * The resolver, answering once per batch for the calls that share a
 * {@link SharedVisibility} (ADR-010, amendment of 2026-10-17).
 *
 * What was resolved is kept against the handle and nowhere else, so it lives
 * exactly as long as the request that made it (the `WeakMap` lets it go with
 * the handle) and is never a cache across requests: a permission that changed
 * is seen by the next request. It is the *promise* that is kept, so a page and
 * its facets in flight together wait on one walk rather than starting two. A
 * batch is keyed by where it starts and the workspace the order was set by,
 * because those are what make two walks the same walk; a request that differs
 * in either resolves for itself. A handle is used only for the filter it was
 * made for, so offering it with another caller's filter resolves afresh.
 */
function batchResolver(resolver: VisibleDocumentResolver): BatchResolver {
  const walks = new WeakMap<SharedVisibility, Map<string, Promise<VisibleDocumentsBatch>>>()
  return (request, shared) => {
    if (shared?.filter !== request.filter) return resolver.resolve(request)
    const batches = walks.get(shared) ?? new Map<string, Promise<VisibleDocumentsBatch>>()
    walks.set(shared, batches)
    const key = `${request.currentWorkspaceId ?? ''}/${request.from}`
    const walk = batches.get(key) ?? resolver.resolve(request)
    batches.set(key, walk)
    return walk
  }
}

interface FacetRow extends Record<string, unknown> {
  facet: FacetName
  value: string
  count: number
}

/**
 * What the query matches, counted (ADR-010, amendment of 2026-10-17).
 *
 * It walks every batch of workspaces the caller may read, as a search pages
 * through them, and adds each batch's counts to the totals: a count is over
 * the whole matching set, so it cannot stop early as `suggest` does. The
 * permission predicate is inside each statement, so a document the caller is
 * denied is never counted.
 *
 * The match is the strict one: the AND of every word, with the same typo arm a
 * search's AND arm has, and never the OR widening. Counts then equal what
 * paging a search to the end shows whenever the search did not need to widen
 * (it only widens below one screenful of matches), and a refinement's count is
 * the number of results it will give.
 */
async function countFacets(
  { deps, resolveBatch, trigramAvailable }: FacetCollaborators,
  query: SearchQuery,
  filter: VisibilityFilter,
  options: FacetsOptions,
): Promise<FacetCounts> {
  const totals: Record<FacetName, Map<string, number>> = {
    tag: new Map(),
    status: new Map(),
    collection: new Map(),
  }

  if (options.facets.length > 0 && filter.workspaceIds.length > 0) {
    const translated = translateQuery(query, askerOf(filter))
    const trigram =
      translated.text.length > 0 && !translated.hasPhrase && (await trigramAvailable())

    let from: number | null = 0
    while (from !== null) {
      const batch = await resolveBatch(
        {
          filter,
          ...(options.currentWorkspaceId === undefined
            ? {}
            : { currentWorkspaceId: options.currentWorkspaceId }),
          from,
        },
        options.visibility,
      )
      if (batch.workspaceIds.length === 0) break
      const statement = facetsQuery({ translated, trigram, batch }, options.facets)
      const { rows } = await withTrigramThreshold(deps, trigram, (executor) =>
        executor.execute<FacetRow>(statement),
      )
      for (const row of rows) {
        addCounts(totals[row.facet], [{ value: row.value, count: Number(row.count) }])
      }
      from = batch.nextFrom
    }
  }

  return Object.fromEntries(
    options.facets.map((facet) => [
      facet,
      // Collections come back whole: the application merges the ones that share a name.
      rankFacetCounts(totals[facet], facet === 'collection' ? totals[facet].size : options.limit),
    ]),
  )
}

/**
 * The matching documents once, and each requested facet as a grouping of the
 * same rows, so counting three facets reads the index once, not three times.
 */
function facetsQuery(
  plan: Pick<QueryPlan, 'translated' | 'trigram' | 'batch'>,
  facets: readonly FacetName[],
): SQL {
  const groupings: Record<FacetName, SQL> = {
    tag: sql`SELECT 'tag' AS facet, path AS value, count(*)::int AS count FROM matched_rows, unnest(tag_paths) AS path GROUP BY path`,
    status: sql`SELECT 'status' AS facet, status AS value, count(*)::int AS count FROM matched_rows GROUP BY status`,
    collection: sql`SELECT 'collection' AS facet, collection_id AS value, count(*)::int AS count FROM matched_rows WHERE collection_id IS NOT NULL GROUP BY collection_id`,
  }
  const requested = [...new Set(facets)].map((facet) => groupings[facet])

  return sql`
    WITH matched AS (
      ${candidates(plan, plan.translated.all, commonPredicate(plan))}
    ), matched_rows AS MATERIALIZED (
      SELECT ${documentSearch.tagPaths} AS tag_paths, ${documentSearch.status} AS status, ${documentSearch.collectionId} AS collection_id
      FROM matched
      JOIN ${documentSearch} ON ${documentSearch.documentId} = matched.document_id
    )
    ${requested.reduce((all, next) => sql`${all} UNION ALL ${next}`)}
  `
}

interface QueryPlan {
  readonly translated: TranslatedQuery
  readonly profile: RankingProfile
  readonly scoredAt: Date
  readonly trigram: boolean
  readonly batch: Awaited<ReturnType<VisibleDocumentResolver['resolve']>>
  readonly filter: VisibilityFilter
  readonly currentWorkspaceId?: WorkspaceId
}

/**
 * The AND arm, and the OR widening when the AND found too little.
 *
 * The first query over-fetches to {@link WIDEN_BELOW_HITS} so that "fewer
 * than a screenful" is an answer rather than a guess; the widening is skipped
 * when the two arms are the same query (one clause), when the author quoted
 * something (an exact demand), and when a cursor already says which arm this
 * page-through is on — switching arms half way down a list would reorder the
 * very list being paged.
 */
async function runArms(
  deps: PostgresSearchIndexDependencies,
  plan: QueryPlan,
  cursor: SearchCursor | null,
  limit: number,
): Promise<{ readonly rows: readonly HitRecord[]; readonly arm: SearchArm }> {
  if (cursor !== null) {
    return { rows: await run(deps, plan, cursor.arm, cursor, limit + 1), arm: cursor.arm }
  }

  const widenable = plan.translated.widenable && !plan.translated.hasPhrase
  const first = await run(deps, plan, 'all', null, Math.max(limit + 1, WIDEN_BELOW_HITS))
  if (!widenable || first.length >= WIDEN_BELOW_HITS) {
    return { rows: first, arm: 'all' }
  }
  return { rows: await run(deps, plan, 'any', null, limit + 1), arm: 'any' }
}

/**
 * One arm, as one statement.
 *
 * The candidate set is gathered first — each `WHERE` using the index that
 * suits it, the full-text arm the GIN index over `search_vector` and the
 * trigram arm the GIN index over `title` — and only then scored, so
 * `ts_rank_cd`, the recency curve and `ts_headline` run over the documents
 * that matched rather than over the whole table.
 *
 * `pg_trgm`'s `%` operator is the indexable one, and it reads its threshold
 * from a session setting rather than taking it inline, so the trigram arm
 * runs inside a transaction that sets it locally. The full-text-only path,
 * which is nearly every search, stays a single statement with no transaction
 * around it.
 */
async function run(
  deps: PostgresSearchIndexDependencies,
  plan: QueryPlan,
  arm: SearchArm,
  cursor: SearchCursor | null,
  limit: number,
): Promise<readonly HitRecord[]> {
  const statement = pageQuery(plan, arm, cursor, limit)
  return withTrigramThreshold(deps, plan.trigram, async (executor) => {
    const { rows } = await executor.execute<HitRecord>(statement)
    return rows
  })
}

/** Something a statement can be executed on: the client, or the transaction that wraps it. */
type Executor = Pick<DrizzleClient, 'execute'>

/**
 * Runs `work` in the transaction that sets the trigram threshold when its
 * statement has a trigram arm, and on the client directly when it has not.
 */
async function withTrigramThreshold<Result>(
  deps: PostgresSearchIndexDependencies,
  trigram: boolean,
  work: (executor: Executor) => Promise<Result>,
): Promise<Result> {
  if (!trigram) return work(deps.db)
  return deps.db.transaction(async (tx) => {
    // The value is this module's own constant, never anything a caller sent.
    await tx.execute(sql.raw(`SET LOCAL pg_trgm.similarity_threshold = ${TRIGRAM_THRESHOLD}`))
    return work(tx)
  })
}

function pageQuery(
  plan: QueryPlan,
  arm: SearchArm,
  cursor: SearchCursor | null,
  limit: number,
): SQL {
  const match = arm === 'all' ? plan.translated.all : plan.translated.any
  const common = commonPredicate(plan)

  return sql`
    WITH matched AS (
      ${candidates(plan, match, common)}
    ), scored AS (
      SELECT
        ${documentSearch.documentId} AS document_id,
        ${documentSearch.workspaceId} AS workspace_id,
        ${documentSearch.title} AS title,
        ${scoreExpression(plan, match)} AS score
      FROM matched
      JOIN ${documentSearch} ON ${documentSearch.documentId} = matched.document_id
    )
    SELECT
      scored.document_id,
      scored.workspace_id,
      scored.title,
      scored.score,
      ${bodyExpression(match)} AS body,
      ${documentSearch.tags} AS tags
    FROM scored
    JOIN ${documentSearch} ON ${documentSearch.documentId} = scored.document_id
    ${keysetPredicate(cursor)}
    ORDER BY scored.score DESC, scored.document_id ASC
    LIMIT ${limit}::int
  `
}

/**
 * What every arm has in common: who may see what, the field filters, and what
 * the author excluded.
 *
 * Combined by hand rather than with `and(...)` because the visibility
 * restriction is always there — a search is always restricted to a batch of
 * workspaces — so there is always at least one, and a fallback for "no
 * predicates at all" would be a branch that can never run.
 */
function commonPredicate(plan: Pick<QueryPlan, 'batch' | 'translated'>): SQL {
  return allOf([
    ...visibilityPredicates(plan.batch.visible, plan.batch.workspaceIds),
    ...plan.translated.predicates,
    ...excludePredicate(plan.translated),
  ])
}

/** The predicates ANDed; never called with none, because a restriction to the batch's workspaces is always among them. */
function allOf(predicates: readonly SQL[]): SQL {
  return predicates.reduce((all, next) => sql`${all} AND ${next}`)
}

/**
 * The candidate ids: one `SELECT` per arm, unioned, so each arm is planned
 * against the index built for it.
 */
function candidates(
  plan: Pick<QueryPlan, 'translated' | 'trigram'>,
  match: SQL | null,
  common: SQL,
): SQL {
  const arms: SQL[] = []
  if (match !== null) {
    arms.push(select(sql`${common} AND ${documentSearch.searchVector} @@ ${match}`))
  }
  if (plan.trigram) {
    arms.push(select(sql`${common} AND ${documentSearch.title} % ${plan.translated.text}`))
  }
  // A query that names no text at all — an empty box, or only field
  // filters — lists what the filters match rather than nothing.
  if (arms.length === 0) arms.push(select(common))
  return arms.reduce((combined, next) => sql`${combined} UNION ${next}`)
}

function select(where: SQL): SQL {
  return sql`SELECT ${documentSearch.documentId} AS document_id FROM ${documentSearch} WHERE ${where}`
}

/**
 * Whether this database can answer a trigram question.
 *
 * Asked of the operator rather than of `pg_extension`, because an extension
 * installed into a schema that is not on the connection's `search_path` is
 * present and unusable, and the answer that matters is whether the query
 * below would run.
 */
export async function probeTrigram(db: DrizzleClient): Promise<boolean> {
  try {
    await db.execute(sql`SELECT similarity('a'::text, 'a'::text)`)
    return true
  } catch {
    return false
  }
}

/**
 * The answer, once, for the lifetime of the process — but only an answer that
 * arrived. A rejected probe is forgotten, so a database that was briefly
 * unreachable is asked again rather than being remembered as broken.
 */
/**
 * The accounts the request is made as, for `by:me`: the user principals in the
 * visibility filter, which is who the route resolved the caller to. A group, the
 * public, and a share link are not a person, so `me` is nobody for them.
 */
function askerOf(filter: VisibilityFilter): Asker {
  return {
    userIds: [...principalsFromKeys(filter.principalKeys)].flatMap((principal) =>
      principal.kind === 'user' ? [principal.userId] : [],
    ),
  }
}

function memoise(probe: () => Promise<boolean>): () => Promise<boolean> {
  let answer: Promise<boolean> | null = null
  return () => {
    answer ??= probe().catch((error: unknown) => {
      answer = null
      throw error
    })
    return answer
  }
}

/**
 * Whether PostgreSQL refused the statement for exceeding one of its own
 * limits.
 *
 * The SQLSTATE is on the driver's error, and the query builder wraps that in
 * an error of its own, so the chain of `cause`s is walked rather than the
 * outermost object asked. The walk is bounded, because a cause chain that
 * loops back on itself would otherwise hang the publish that produced it.
 */
export function isProgramLimitExceeded(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) return false
    const candidate = current as { code?: unknown; cause?: unknown }
    if (candidate.code === PROGRAM_LIMIT_EXCEEDED) return true
    current = candidate.cause
  }
  return false
}

/** Deep enough for a driver error wrapped by a query builder, and no deeper. */
const MAX_CAUSE_DEPTH = 8

/**
 * The visibility filter, as SQL.
 *
 * The workspace restriction is always the batch this request resolved. Within
 * it, a workspace the caller may read whole is named and nothing more; only a
 * workspace where the walk withheld something contributes document ids, so
 * the ordinary search carries no ids at all. An instance administrator
 * bypasses per-document resolution by ADR-012 and is restricted by workspace
 * alone.
 */
function visibilityPredicates(
  visible: VisibleDocuments,
  workspaceIds: readonly WorkspaceId[],
): readonly SQL[] {
  const inBatch = sql`${documentSearch.workspaceId} = ANY(${sql.param([...workspaceIds])}::text[])`
  if (visible.kind === 'everything') return [inBatch]

  const whole = sql`${documentSearch.workspaceId} = ANY(${sql.param([...visible.wholeWorkspaces])}::text[])`
  const named = sql`${documentSearch.documentId} = ANY(${sql.param([...visible.documentIds])}::text[])`
  return [inBatch, sql`(${whole} OR ${named})`]
}

/** What the author excluded, if anything. */
function excludePredicate(translated: TranslatedQuery): readonly SQL[] {
  return translated.exclude === null
    ? []
    : [sql`NOT (${documentSearch.searchVector} @@ ${translated.exclude})`]
}

/**
 * `RankingProfile` as one scoring expression.
 *
 * The relevance of the text match is multiplied by the boosts, rather than
 * added to them, so a boost changes the order among documents that matched
 * and can never promote one that barely matched above one that matched well.
 * Trigram similarity is the exception: it is *added*, because a document that
 * the full-text query did not match at all has a relevance of zero and would
 * otherwise stay at zero however close its title is.
 */
function scoreExpression(plan: QueryPlan, match: SQL | null): SQL {
  const relevance =
    match === null
      ? // A query with no text makes every document that passed the filters
        // equally relevant, so the recency curve alone decides the order.
        sql`1.0::float8`
      : sql`ts_rank_cd(${weightArray(plan.profile)}, ${documentSearch.searchVector}, ${match}, ${RANK_NORMALISATION}::int)::float8`

  const withTypos =
    plan.trigram && match !== null
      ? sql`(${relevance} + similarity(${documentSearch.title}, ${plan.translated.text})::float8)`
      : relevance

  return sql`${withTypos} * ${recencyExpression(plan)} * ${phraseExpression(plan)} * ${affinityExpression(plan)}`
}

/**
 * `ts_rank_cd`'s weights, in its own order: `{D, C, B, A}`.
 *
 * The profile's weights are relative to each other and `ts_rank_cd` wants
 * them between 0 and 1, so they are scaled by the largest. Nothing is stored
 * unweighted, so D never applies and is given the body's weight rather than a
 * number that would mean something different.
 */
function weightArray(profile: RankingProfile): SQL {
  const { title, headings, body } = profile.fieldWeights
  const largest = Math.max(title, headings, body, Number.EPSILON)
  const unweighted = body / largest
  return sql`${sql.param([unweighted, unweighted, headings / largest, title / largest])}::float4[]`
}

/** `RecencyBoost`, as the same halving curve `recencyMultiplier` computes in TypeScript. */
function recencyExpression(plan: QueryPlan): SQL {
  const { halfLifeDays, maxBoost } = plan.profile.recencyBoost
  return sql`(1 + ${maxBoost}::float8 * power(2, -greatest(extract(epoch FROM (${plan.scoredAt.toISOString()}::timestamptz - ${documentSearch.updatedAt})) / 86400.0, 0) / ${halfLifeDays}::float8))`
}

function phraseExpression(plan: QueryPlan): SQL {
  return plan.translated.phrases === null
    ? sql`1`
    : sql`(CASE WHEN ${documentSearch.searchVector} @@ ${plan.translated.phrases} THEN ${plan.profile.exactPhraseBoost}::float8 ELSE 1 END)`
}

/**
 * The current workspace's boost, applied before the cutoff rather than after
 * it: `groupByWorkspaceAffinity` can only order what the engine returned, so a
 * current-workspace document just outside the top `limit` has to be brought
 * inside it here or it is never seen at all.
 */
function affinityExpression(plan: QueryPlan): SQL {
  return plan.currentWorkspaceId === undefined
    ? sql`1`
    : sql`(CASE WHEN ${documentSearch.workspaceId} = ${plan.currentWorkspaceId} THEN ${plan.profile.workspaceAffinity.currentWorkspaceBoost}::float8 ELSE 1 END)`
}

/**
 * The window of body text a snippet is built from.
 *
 * `ts_headline` is asked for a single fragment because it is the one thing
 * that knows which part of a long body the query actually covered, including
 * where a *stemmed* match landed. `StartSel` and `StopSel` are empty, so what
 * comes back is plain text and not markup: highlighting is the caller's to do,
 * from the offsets `buildSnippet` computes over this window by finding the
 * query's words in it literally. The two do not always agree — a document
 * matched only after stemming (`failing` for `failover`'s neighbours, say)
 * gives a window with the right text and no ranges to mark — and that is the
 * intended degradation: the excerpt is still the right excerpt. When the
 * query matched nothing in the body at all, because it matched the title,
 * `ts_headline` returns the opening of the document, which is the right thing
 * to show.
 */
function bodyExpression(match: SQL | null): SQL {
  return match === null
    ? sql`left(${documentSearch.body}, ${BODY_PREVIEW_CHARACTERS}::int)`
    : sql`ts_headline('english', ${documentSearch.body}, ${match}, ${HEADLINE_OPTIONS})`
}

/** Keyset paging: everything scored below the cursor, and ties broken by id exactly as the order does. */
function keysetPredicate(cursor: SearchCursor | null): SQL {
  const keyset = cursor?.keyset ?? null
  return keyset === null
    ? sql``
    : sql`WHERE (scored.score < ${keyset.score}::float8 OR (scored.score = ${keyset.score}::float8 AND scored.document_id > ${keyset.documentId}))`
}

interface NextCursorInput {
  /** Whether this batch of workspaces still has results after the page just cut. */
  readonly more: boolean
  readonly last: HitRecord | undefined
  readonly arm: SearchArm
  /** Where the next batch of workspaces starts, or null when there is none. */
  readonly from: number | null
  readonly batchStart: number
  readonly at: string
}

/**
 * The cursor for the page after this one: more of this batch of workspaces if
 * there is more, else the start of the next batch, else nothing. A batch that
 * runs out is not the end of the search — it is the end of the workspaces
 * whose permissions this request resolved.
 */
function nextCursorFor(input: NextCursorInput): { nextCursor?: string } {
  if (input.more && input.last !== undefined) {
    return {
      nextCursor: encodeSearchCursor({
        from: input.batchStart,
        arm: input.arm,
        at: input.at,
        keyset: {
          score: Number(input.last.score),
          documentId: input.last.document_id as DocumentId,
        },
      }),
    }
  }
  if (input.from === null) return {}
  return {
    nextCursor: encodeSearchCursor({
      from: input.from,
      arm: input.arm,
      at: input.at,
      keyset: null,
    }),
  }
}

function toHit(record: HitRecord): SearchHit {
  return {
    documentId: record.document_id as DocumentId,
    workspaceId: record.workspace_id as WorkspaceId,
    title: record.title,
    body: record.body,
    tags: record.tags,
    score: Number(record.score),
  }
}
