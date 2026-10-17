import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { listVisibleWorkspaces, suggestSearchValues } from '@quill/application'
import type { VisibleWorkspace } from '@quill/application'
import type { CollectionId, WorkspaceId } from '@quill/domain'
import type { FacetCounts } from '@quill/application'
import type { QueryParseError, SearchServiceResults } from '@quill/search'
import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'

import { authorizerFor, isInstanceAdmin } from '../application/authorization.ts'
import { resolveWorkspaceId } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'
import { notFound, unprocessable } from '../errors.ts'
import { decodeSearchCursor } from '../infrastructure/search/cursor.ts'
import { sessionRateLimit } from '../plugins/rate-limit.ts'
import {
  facetNamesFrom,
  FACET_VALUE_LIMIT,
  FACETS_PATTERN,
  toFacetsResponse,
} from './search-facets.ts'
import type { FacetsResponse } from './search-facets.ts'
import { unsearchable } from './search-query.ts'
import { SearchResultsSchema, toSearchResponse } from './search-response.ts'
import type { SearchContext } from './search-response.ts'
import { shareVisibility, visibilityFilter } from '@quill/search'

/**
 * `GET /api/search` (ADR-010, quill-plan.md §15;
 * `docs/architecture/api-contract-m2.md`).
 *
 * Search is the one surface that crosses workspaces, so the answer is shaped
 * that way rather than as one flat list: `current` is what matched in the
 * workspace the caller is looking at, and `elsewhere` is every other
 * workspace they may read, grouped, each group ordered by its own best match.
 * A client renders the first as results and the second as suggestions.
 *
 * Three things are deliberate:
 *
 * - **The workspaces searched are the ones the caller may read**, resolved by
 *   `listVisibleWorkspaces` — the same answer the workspace picker gives — and
 *   the per-document filter is applied inside the engine's query (ADR-012).
 *   Search never widens what a person can see; it only makes it findable.
 * - **Nothing is audited.** A search is a read, and an audit row per keystroke
 *   would be a log of what everybody was looking for, which is a privacy
 *   liability rather than a security record (ADR-011 audits without secrets;
 *   this is the same instinct applied to queries).
 * - **It has its own rate limit**, keyed by session, because a search box
 *   answers as somebody types and the authentication budget is deliberately
 *   far too small for that.
 */

const SearchQuerystringSchema = Type.Object({
  /**
   * At least one character, because an empty box is not a search: `GET
   * /api/search` with nothing in it would be an endpoint for enumerating
   * every document somebody may read, which is a different thing with
   * different rules.
   */
  q: Type.String({ minLength: 1, maxLength: 512 }),
  /** The workspace the caller is in, by id or slug. Absent means no workspace is preferred. */
  workspace: Type.Optional(Type.String({ minLength: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  cursor: Type.Optional(Type.String({ maxLength: 1024 })),
  /**
   * Which facets to count, comma-separated from `tag`, `status`, `collection`.
   * Absent means none and costs nothing; anything else is a `400`.
   */
  facets: Type.Optional(Type.String({ pattern: FACETS_PATTERN })),
})

const SUGGESTION_FIELDS = ['by', 'team', 'tag', 'collection', 'in', 'status'] as const

const SuggestionsQuerystringSchema = Type.Object({
  /** Which filter's value is being completed. Anything else is a `400` from validation. */
  field: Type.Union(SUGGESTION_FIELDS.map((field) => Type.Literal(field))),
  /** What has been typed after the colon; empty offers the most relevant values outright. */
  prefix: Type.Optional(Type.String({ maxLength: 100 })),
  /** The workspace the caller is in, by id or slug, as for a search: it changes the order of the lookup, never the visibility. */
  workspace: Type.Optional(Type.String({ minLength: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
})

const SuggestionsResponseSchema = Type.Object({
  field: Type.String(),
  suggestions: Type.Array(
    Type.Object({
      /** What goes after `field:`; the client quotes it when it needs to. */
      value: Type.String(),
      /** What the list shows. */
      label: Type.String(),
    }),
  ),
})

/** Ten is a dropdown; more is a list nobody reads, and a bigger bound is a bigger scan per keystroke. */
const DEFAULT_SUGGESTIONS = 8

export function searchRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    app.get(
      '/api/search',
      {
        preHandler: app.requireSession,
        config: sessionRateLimit('search', deps.config.searchRateLimitMax),
        schema: {
          querystring: SearchQuerystringSchema,
          response: { 200: SearchResultsSchema },
        },
      },
      async (request) => {
        const authorizer = authorizerFor(deps, request)
        const identities = await authorizer.identities()
        const readable = await listVisibleWorkspaces(deps, {
          identities,
          seesEverything: await isInstanceAdmin(deps, request),
        })

        refuseUnsearchableQuery(request.query.q)

        const currentWorkspaceId = await resolveCurrent(deps, request.query.workspace, readable)
        const cursor = request.query.cursor
        if (cursor !== undefined && decodeSearchCursor(cursor) === null) {
          throw unprocessable('invalid_cursor', 'That cursor did not come from a search here')
        }

        const filter = visibilityFilter(
          readable.workspaces.map((visible) => visible.workspace.id as WorkspaceId),
          identities,
        )
        const facetNames =
          request.query.facets === undefined ? [] : facetNamesFrom(request.query.facets)

        // The counts and the page are independent questions over the same
        // set, so they are asked together; the caller's visibility is worked
        // out once for both, which is most of what either costs.
        const visibility = shareVisibility(filter)
        const [results, facets] = await Promise.all([
          deps.search.search({
            queryText: request.query.q,
            filter,
            visibility,
            ...(currentWorkspaceId === null ? {} : { currentWorkspaceId }),
            ...(request.query.limit === undefined ? {} : { limit: request.query.limit }),
            ...(cursor === undefined ? {} : { cursor }),
          }),
          facetNames.length === 0
            ? undefined
            : deps.search.facets({
                queryText: request.query.q,
                filter,
                visibility,
                ...(currentWorkspaceId === null ? {} : { currentWorkspaceId }),
                facets: facetNames,
                limit: FACET_VALUE_LIMIT,
              }),
        ])

        const page = answered(results)
        const response = toSearchResponse(
          request.query.q,
          page,
          await loadContext(deps, page, readable.workspaces),
        )
        return facets === undefined
          ? response
          : { ...response, facets: await describeFacets(deps, answered(facets)) }
      },
    )

    /**
     * `GET /api/search/suggestions`: completes the value of a filter as it is
     * typed (ADR-010, amendment of 2026-10-17).
     *
     * It is a search with the document left off, and keeps a search's rules:
     * it is drawn from what the caller may already read, answers names and
     * never addresses, shares the search rate-limit bucket (a box asks as
     * somebody types, and the two come from the same box), and is not
     * audited — a log of what everybody was about to look for is a liability
     * and not a record. The orchestration is `suggestSearchValues`; this only
     * resolves who is asking and where.
     */
    app.get(
      '/api/search/suggestions',
      {
        preHandler: app.requireSession,
        config: sessionRateLimit('search', deps.config.searchRateLimitMax),
        schema: {
          querystring: SuggestionsQuerystringSchema,
          response: { 200: SuggestionsResponseSchema },
        },
      },
      async (request) => {
        const authorizer = authorizerFor(deps, request)
        const identities = await authorizer.identities()
        const readable = await listVisibleWorkspaces(deps, {
          identities,
          seesEverything: await isInstanceAdmin(deps, request),
        })
        const currentWorkspaceId = await resolveCurrent(deps, request.query.workspace, readable)

        const suggestions = await suggestSearchValues(deps, {
          field: request.query.field,
          prefix: request.query.prefix ?? '',
          limit: request.query.limit ?? DEFAULT_SUGGESTIONS,
          identities,
          readable: readable.workspaces,
          ...(currentWorkspaceId === null ? {} : { currentWorkspaceId }),
        })

        return { field: request.query.field, suggestions: [...suggestions] }
      },
    )
  }
}

/**
 * The answer of a service call, or the refusal for a query it could not read.
 *
 * `refuseUnsearchableQuery` parsed this same text a moment ago and threw if it
 * would not parse, so the service's own refusal is unreachable from here; it
 * is answered rather than ignored because the day the two readings differ is
 * the day this matters.
 */
function answered<Value>(
  result:
    | { readonly ok: true; readonly value: Value }
    | { readonly ok: false; readonly error: QueryParseError },
): Value {
  /* v8 ignore next 6 -- see above: unreachable while the grammar has one reading. */
  if (!result.ok) {
    throw unprocessable('invalid_query', result.error.message, {
      kind: result.error.kind,
      position: result.error.position,
    })
  }
  return result.value
}

/**
 * The engine's counts as the response, with the collections named from one
 * lookup for all of them (rule 13: never one per value).
 */
async function describeFacets(deps: AppDependencies, counts: FacetCounts): Promise<FacetsResponse> {
  const collectionIds = (counts.collection ?? []).map((entry) => entry.value as CollectionId)
  const collections =
    collectionIds.length === 0 ? [] : await deps.uow.repos.collections.listByIds(collectionIds)
  return toFacetsResponse(
    counts,
    new Map(collections.map((collection) => [collection.id, collection.name])),
    FACET_VALUE_LIMIT,
  )
}

/**
 * Refuses a query that asks for everything.
 *
 * The rule is `unsearchable` in `search-query.ts`, which the public site reads
 * too; what differs is the answer, and that is this route's to give. The parse
 * runs again inside the service a moment later — a few microseconds spent to
 * keep one grammar: the route decides what it will accept, `createSearchService`
 * owns the pipeline, and neither has a second reading of the language.
 */
function refuseUnsearchableQuery(queryText: string): void {
  const refusal = unsearchable(queryText)
  if (refusal === null) return
  if (refusal.kind === 'unparsed') {
    throw unprocessable('invalid_query', refusal.error.message, {
      kind: refusal.error.kind,
      position: refusal.error.position,
    })
  }
  throw unprocessable(
    'invalid_query',
    'A search needs something to look for, not only things to leave out',
    { kind: 'nothing-to-search-for', position: 0 },
  )
}

/**
 * The workspace the caller says they are in, or null.
 *
 * It has to be one they may read, and it is checked against the readable set
 * rather than by a second permission call: a workspace that is not in that
 * set would contribute nothing to the results anyway, and answering "not
 * found" says no more than the picker already does.
 */
async function resolveCurrent(
  deps: AppDependencies,
  reference: string | undefined,
  readable: { readonly workspaces: readonly VisibleWorkspace[] },
): Promise<WorkspaceId | null> {
  if (reference === undefined) return null
  const workspaceId = await resolveWorkspaceId(deps, reference)
  const known = readable.workspaces.some((visible) => visible.workspace.id === workspaceId)
  if (!known) throw notFound('Workspace not found')
  return workspaceId
}

/**
 * Everything the response needs that the index does not hold: the document
 * rows behind the hits, and the collections they sit in.
 *
 * One query for every document on the page, one for everyone who has published
 * any of them, and one per workspace that actually appears in it — never one
 * per hit (AGENTS.md rule 13).
 */
async function loadContext(
  deps: AppDependencies,
  results: SearchServiceResults,
  readable: readonly VisibleWorkspace[],
): Promise<SearchContext> {
  const hits = [...results.current, ...results.elsewhere.flatMap((group) => group.hits)]
  const documents = await deps.uow.repos.documents.listByIds(hits.map((hit) => hit.documentId))
  const workspaceIds = new Set(documents.map((document) => document.workspaceId))

  const [collections, contributorsById] = await Promise.all([
    Promise.all(
      [...workspaceIds].map((workspaceId) =>
        deps.uow.repos.collections.listByWorkspace(workspaceId),
      ),
    ),
    deps.uow.repos.revisions.listContributorsForDocuments(documents.map((document) => document.id)),
  ])

  return {
    documentsById: new Map(documents.map((document) => [document.id, document])),
    workspacesById: new Map(
      readable.map((visible) => [visible.workspace.id as WorkspaceId, visible.workspace]),
    ),
    collectionsById: new Map(
      collections.flat().map((collection) => [collection.id as CollectionId, collection]),
    ),
    contributorsById,
  }
}
