import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { clearDocumentHistory, recordDocumentView } from '@quill/application'
import type { FastifyPluginAsync } from 'fastify'

import { authorizerFor, requireDocumentAccess } from '../application/authorization.ts'
import { resolveDocumentId } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'
import { IdParamsSchema } from './document-schemas.ts'

/**
 * What a person has opened (ADR-053, "API contract (first build)").
 *
 * The record is the person's own: written when they open a document, read
 * only into their own home, and cleared by them. Neither route is audited,
 * because a view is not an act on the document and an administrator never
 * sees it.
 */
export function historyRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    app.post(
      '/api/documents/:id/view',
      { preHandler: app.requireSession, schema: { params: IdParamsSchema } },
      async (request, reply) => {
        const session = requireAuthenticatedSession(request)
        const access = await requireDocumentAccess(
          authorizerFor(deps, request),
          await resolveDocumentId(deps, request.params.id),
          'view',
        )
        await recordDocumentView(deps, {
          userId: session.userId,
          documentId: access.document.id,
          workspaceId: access.document.workspaceId,
        })
        return reply.code(204).send()
      },
    )

    app.delete('/api/me/history', { preHandler: app.requireSession }, async (request, reply) => {
      await clearDocumentHistory(deps, requireAuthenticatedSession(request).userId)
      return reply.code(204).send()
    })
  }
}
