import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyPluginAsync } from 'fastify'

import { createEditingService } from '../application/editing-service.ts'
import { resolveDocumentId } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'
import { AppError, notFound } from '../errors.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'

const WriteDraftBody = Type.Object({
  ast: Type.Unknown(),
  expectedVersion: Type.Integer({ minimum: 0 }),
})

const IdParams = Type.Object({ id: Type.String() })

/**
 * `PUT /api/documents/:id/draft` exactly per the ADR-021 API contract table:
 * `200 { draftVersion, updatedAt }` on success, `423 lock_lost`,
 * `409 stale_version`, `401 session_expired` (the last one is the
 * `requireSession` preHandler's own `sessionExpired` error — see
 * `plugins/session.ts`).
 *
 * A write is gated by the lock *and* by the capability: the lock says nobody
 * else is editing, and `edit` says this person may. `application/editing-service.ts`
 * re-resolves the second on every write, because a grant withdrawn mid-session
 * used to leave the holder writing until they closed the tab (finding H4).
 * Publish (writing to the content store) is a separate route:
 * `POST /api/documents/:id/publish` (see `documents.ts`).
 */
export function draftRoutes(deps: AppDependencies): FastifyPluginAsync {
  const editing = createEditingService(deps)

  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    app.get(
      '/api/documents/:id/draft',
      { preHandler: app.requireSession, schema: { params: IdParams } },
      async (request) => {
        const draft = await editing.readDraft({
          request,
          documentId: await resolveDocumentId(deps, request.params.id),
        })
        if (draft === null) {
          throw notFound('Draft not found')
        }
        return draft
      },
    )

    app.put(
      '/api/documents/:id/draft',
      {
        preHandler: app.requireVerifiedSession,
        schema: { params: IdParams, body: WriteDraftBody },
      },
      async (request) => {
        const session = requireAuthenticatedSession(request)
        const result = await editing.writeDraft({
          request,
          documentId: await resolveDocumentId(deps, request.params.id),
          sessionId: session.sessionId,
          expectedVersion: request.body.expectedVersion,
          ast: request.body.ast,
        })

        if (result.ok) {
          return { draftVersion: result.draft.draftVersion, updatedAt: result.draft.updatedAt }
        }
        if (result.reason === 'lock_lost') {
          throw new AppError(423, 'lock_lost', 'You do not hold a valid lock on this document', {
            holder: result.holder,
          })
        }
        if (result.reason === 'stale_version') {
          throw new AppError(409, 'stale_version', 'Your draft version is behind the current one', {
            currentVersion: result.currentVersion,
          })
        }
        throw notFound('Draft not found')
      },
    )
  }
}
