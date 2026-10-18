import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyPluginAsync } from 'fastify'

import { authorizerFor } from '../application/authorization.ts'
import { readableDocuments } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'

/** More links than any page carries; a body past it resolves the rest when they are followed. */
export const MAX_LINK_REFERENCES = 200

const ResolveLinksBodySchema = Type.Object({
  references: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
    maxItems: MAX_LINK_REFERENCES,
  }),
})

const ResolvedLinksSchema = Type.Object({
  /** One entry per reference the reader may open; the rest are simply absent. */
  links: Type.Array(Type.Object({ reference: Type.String(), href: Type.String() })),
})

/**
 * `POST /api/documents/links`: the reading addresses of the documents a
 * body links to, for the reader asking (ADR-035).
 *
 * A body stores a link to another document as `/d/<id>`, which never goes
 * stale but says nothing to somebody hovering over it or copying it. The
 * cached body is one artefact for every reader (ADR-031), so it cannot carry
 * the readable `/w/<workspace>/d/<title>-<key>`: whether a reader may see the
 * title and the workspace is theirs alone. The reading view asks here once
 * per body — every reference in one request, never one per link — and puts
 * the answers on the links it already shows.
 *
 * A reference that names nothing and one the reader may not open are both
 * left out, indistinguishably (ADR-012); their links keep the `/d/<id>` form,
 * which the app's own route answers with the same not-found. A `POST`
 * because a body's references do not fit in an address, though nothing is
 * written.
 */
export function documentLinksRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    app.post(
      '/api/documents/links',
      {
        preHandler: app.requireSession,
        schema: { body: ResolveLinksBodySchema, response: { 200: ResolvedLinksSchema } },
      },
      async (request, reply) => {
        const references = [...new Set(request.body.references)]
        const readable = await readableDocuments(deps, authorizerFor(deps, request), references)
        // It depends on the reader and on other documents' titles.
        reply.header('cache-control', 'private, no-cache')
        return {
          links: [...readable].map(([reference, { href }]) => ({ reference, href })),
        }
      },
    )
  }
}
