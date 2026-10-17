import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { documentReference, listChildPages } from '@quill/application'
import { parseChildPagesDepth, renderChildPages } from '@quill/markdown'
import type { FastifyPluginAsync } from 'fastify'

import { authorizerFor, requireDocumentAccess } from '../application/authorization.ts'
import { resolveDocumentId } from '../application/references.ts'
import { countChildPages, toChildPages } from '../child-pages/present.ts'
import type { AppDependencies } from '../dependencies.ts'
import { AppError } from '../errors.ts'
import { sessionRateLimit } from '../plugins/rate-limit.ts'
import { IdParamsSchema } from './document-schemas.ts'

const ChildPagesQuerySchema = Type.Object({
  depth: Type.Integer({ minimum: 1, maximum: 6, default: 1 }),
  sort: Type.Union([Type.Literal('manual'), Type.Literal('title'), Type.Literal('updated')], {
    default: 'manual',
  }),
  excerpts: Type.Boolean({ default: false }),
  icons: Type.Boolean({ default: false }),
})

const ChildPagesSchema = Type.Object({
  /** The list, or the empty state, drawn by the one template every surface shares. */
  html: Type.String(),
  /** How many pages it lists, at every depth. */
  count: Type.Integer({ minimum: 0 }),
})

/**
 * `GET /api/documents/:id/children`: what fills a `::children` slot in the
 * app (ADR-056, ADR-032).
 *
 * The body is cached for every reader (ADR-031); this is the part that
 * depends on who is reading, so it is answered per request, through the one
 * resolver, from the subtree the child pages cache holds. It answers HTML
 * from `@quill/markdown`'s template rather than data, so the app, the public
 * site and export draw a list one way; every word in it is escaped by the
 * serialiser, and every address is the page's reading address in the app,
 * named by its short key (ADR-035; AGENTS.md rule 8).
 */
export function childPagesRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    app.get(
      '/api/documents/:id/children',
      {
        preHandler: app.requireSession,
        // Each answer walks a subtree, so a reader's budget bounds how often.
        config: sessionRateLimit('child-pages', deps.config.browseRateLimitMax),
        schema: {
          params: IdParamsSchema,
          querystring: ChildPagesQuerySchema,
          response: { 200: ChildPagesSchema },
        },
      },
      async (request, reply) => {
        const authorizer = authorizerFor(deps, request)
        const access = await requireDocumentAccess(
          authorizer,
          await resolveDocumentId(deps, request.params.id),
          'view',
        )
        const { depth, sort, excerpts, icons } = request.query
        const listed = await listChildPages(deps, {
          parent: access.document,
          workspace: access.workspace,
          options: { depth, sort },
          audience: {
            kind: 'reader',
            identities: await authorizer.identities(),
            seesEverything: access.isInstanceAdmin,
          },
        })
        /* v8 ignore next 2 -- the authorizer walked the same tree a moment ago. */
        if (listed.kind === 'broken-tree') {
          throw new AppError(500, 'broken_tenancy_tree', 'The workspace cannot be placed')
        }
        const pages = toChildPages(
          listed.pages,
          (document) => `/w/${access.workspace.slug}/d/${documentReference(document)}`,
        )
        // It depends on the reader and on other documents, so it is never
        // shared and never reused without asking.
        reply.header('cache-control', 'private, no-cache')
        return {
          html: renderChildPages(
            pages,
            {
              /* v8 ignore next -- the schema has already bounded it to 1–6. */
              depth: parseChildPagesDepth(String(depth)) ?? 1,
              sort,
              excerpts,
              icons,
            },
            { more: listed.more },
          ),
          count: countChildPages(pages),
        }
      },
    )
  }
}
