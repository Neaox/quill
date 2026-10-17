import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { getHomeSummary } from '@quill/application'
import type { HomeDocument, HomeRecentDocument, HomeViewedDocument } from '@quill/application'
import type { FastifyPluginAsync } from 'fastify'

import { authorizerFor, isInstanceAdmin } from '../application/authorization.ts'
import type { AppDependencies } from '../dependencies.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'

/** How many never-published documents the home page's Continue writing shows. */
export const HOME_DRAFT_LIMIT = 5

/** How many published changes the home page's Recently updated shows. */
export const HOME_RECENT_LIMIT = 10

const HomeDocumentSchema = Type.Object({
  id: Type.String(),
  shortId: Type.String(),
  slug: Type.String(),
  title: Type.String(),
  workspaceId: Type.String(),
  updatedAt: Type.String({ format: 'date-time' }),
})

const HomeRecentDocumentSchema = Type.Composite([
  HomeDocumentSchema,
  Type.Object({
    /** Who last published, restored, renamed or moved it; null when that was never recorded. */
    updatedBy: Type.Union([Type.Object({ id: Type.String(), name: Type.String() }), Type.Null()]),
  }),
])

const HomeViewedDocumentSchema = Type.Object({
  id: Type.String(),
  shortId: Type.String(),
  slug: Type.String(),
  title: Type.String(),
  workspaceId: Type.String(),
  viewedAt: Type.String({ format: 'date-time' }),
})

const HomeScopeSchema = Type.Union([Type.Literal('mine'), Type.Literal('everywhere')])

const HomeQuerySchema = Type.Object({ scope: Type.Optional(HomeScopeSchema) })

const HomeWorkspaceStatsSchema = Type.Object({
  workspaceId: Type.String(),
  documentCount: Type.Integer({ minimum: 0 }),
  draftCount: Type.Integer({ minimum: 0 }),
  /** When anything in the workspace last changed; null while it is empty. */
  updatedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  /** The caller's views plus documents they created here in the last 90 days; 0 when none. */
  engagement: Type.Integer({ minimum: 0 }),
})

const HomeSummarySchema = Type.Object({
  /** One row per workspace whose documents could be read. */
  stats: Type.Array(HomeWorkspaceStatsSchema),
  drafts: Type.Object({
    /** Every never-published document the caller created, of which `items` are the newest. */
    total: Type.Integer({ minimum: 0 }),
    items: Type.Array(HomeDocumentSchema),
  }),
  recent: Type.Array(HomeRecentDocumentSchema),
  /** What the caller opened most recently and can still open, newest first (at most 8). */
  jumpBackIn: Type.Array(HomeViewedDocumentSchema),
  /** The scope `recent` was computed for. */
  scope: HomeScopeSchema,
  /** Whether the caller has opened or created anything in the last 90 days. */
  hasHistory: Type.Boolean(),
  /** Whether anything at all has been published: the set-up checklist's last step. */
  anyPublished: Type.Boolean(),
})

const toResponse = <T extends HomeDocument | HomeRecentDocument>(document: T) => ({
  ...document,
  updatedAt: document.updatedAt.toISOString(),
})

const toViewedResponse = (document: HomeViewedDocument) => ({
  ...document,
  viewedAt: document.viewedAt.toISOString(),
})

/**
 * What the signed-in home shows, in one bounded answer (`docs/design/home.md`).
 *
 * The page's figures used to be counted in the browser from every workspace's
 * whole document list. Here they are counted next to the data, through the
 * same visibility pass every other list uses, so the answer never mentions a
 * document the caller could not open and never grows with the instance beyond
 * one small row per workspace.
 */
export function homeRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    app.get(
      '/api/home',
      {
        preHandler: app.requireSession,
        schema: { querystring: HomeQuerySchema, response: { 200: HomeSummarySchema } },
      },
      async (request) => {
        const summary = await getHomeSummary(deps, {
          userId: requireAuthenticatedSession(request).userId,
          scope: request.query.scope,
          now: deps.clock.now(),
          identities: await authorizerFor(deps, request).identities(),
          seesEverything: await isInstanceAdmin(deps, request),
          draftLimit: HOME_DRAFT_LIMIT,
          recentLimit: HOME_RECENT_LIMIT,
        })
        return {
          stats: summary.stats.map((row) => ({
            ...row,
            updatedAt: row.updatedAt?.toISOString() ?? null,
          })),
          drafts: { total: summary.drafts.total, items: summary.drafts.items.map(toResponse) },
          recent: summary.recent.map(toResponse),
          jumpBackIn: summary.jumpBackIn.map(toViewedResponse),
          scope: summary.scope,
          hasHistory: summary.hasHistory,
          anyPublished: summary.anyPublished,
        }
      },
    )
  }
}
