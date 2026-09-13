import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { listVisibleWorkspaces } from '@quill/application'
import type { VisibleWorkspace } from '@quill/application'
import type { CollectionId, WorkspaceId } from '@quill/domain'
import type { SearchServiceResults } from '@quill/search'
import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'

import { authorizerFor, isInstanceAdmin } from '../application/authorization.ts'
import { resolveWorkspaceId } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'
import { notFound, unprocessable } from '../errors.ts'
import { decodeSearchCursor } from '../infrastructure/search/cursor.ts'
import { sessionRateLimit } from '../plugins/rate-limit.ts'
import { unsearchable } from './search-query.ts'
import { SearchResultsSchema, toSearchResponse } from './search-response.ts'
import type { SearchContext } from './search-response.ts'
import { visibilityFilter } from '@quill/search'

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
})

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

        const results = await deps.search.search({
          queryText: request.query.q,
          filter: visibilityFilter(
            readable.workspaces.map((visible) => visible.workspace.id as WorkspaceId),
            identities,
          ),
          ...(currentWorkspaceId === null ? {} : { currentWorkspaceId }),
          ...(request.query.limit === undefined ? {} : { limit: request.query.limit }),
          ...(cursor === undefined ? {} : { cursor }),
        })

        /* v8 ignore next 6 -- `refuseUnsearchableQuery` parsed this same text a
           moment ago and threw if it would not parse, so the service's own
           refusal is unreachable from here; it is answered rather than ignored
           because the day the two readings differ is the day this matters. */
        if (!results.ok) {
          throw unprocessable('invalid_query', results.error.message, {
            kind: results.error.kind,
            position: results.error.position,
          })
        }

        return toSearchResponse(
          request.query.q,
          results.value,
          await loadContext(deps, results.value, readable.workspaces),
        )
      },
    )
  }
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
 * One query for every document on the page and one per workspace that
 * actually appears in it — never one per hit (AGENTS.md rule 13).
 */
async function loadContext(
  deps: AppDependencies,
  results: SearchServiceResults,
  readable: readonly VisibleWorkspace[],
): Promise<SearchContext> {
  const hits = [...results.current, ...results.elsewhere.flatMap((group) => group.hits)]
  const documents = await deps.uow.repos.documents.listByIds(hits.map((hit) => hit.documentId))
  const workspaceIds = new Set(documents.map((document) => document.workspaceId))

  const collections = await Promise.all(
    [...workspaceIds].map((workspaceId) => deps.uow.repos.collections.listByWorkspace(workspaceId)),
  )

  return {
    documentsById: new Map(documents.map((document) => [document.id, document])),
    workspacesById: new Map(
      readable.map((visible) => [visible.workspace.id as WorkspaceId, visible.workspace]),
    ),
    collectionsById: new Map(
      collections.flat().map((collection) => [collection.id as CollectionId, collection]),
    ),
  }
}
