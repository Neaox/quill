import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyPluginAsync } from 'fastify'

import { createEditingService } from '../application/editing-service.ts'
import { resolveDocumentId } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'
import { AppError } from '../errors.ts'
import { accountKeyFromSession, accountRateLimit, addressRateLimit } from '../plugins/rate-limit.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'

const IdParams = Type.Object({ id: Type.String() })

/**
 * Lock acquire/heartbeat/release/takeover exactly per the ADR-021 API
 * contract table (and `docs/research/r05-draft-locking.md`'s client
 * contract), including the exact status codes: `409 held` on acquire,
 * `410 expired` / `409 taken_over` / `404 released` on heartbeat, an
 * unconditional `204` on release, and `403` on takeover by a non-admin.
 *
 * Authorisation lives in `application/editing-service.ts`, which re-resolves
 * `edit` on every heartbeat: a lock is not a substitute for a permission
 * check, and a heartbeat that never re-checked let a revoked editor hold a
 * document for as long as their browser stayed open.
 */
export function lockRoutes(deps: AppDependencies): FastifyPluginAsync {
  const editing = createEditingService(deps)

  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    app.post(
      '/api/documents/:id/lock/acquire',
      { preHandler: app.requireVerifiedSession, schema: { params: IdParams } },
      async (request) => {
        const session = requireAuthenticatedSession(request)
        const result = await editing.acquireLock({
          request,
          documentId: await resolveDocumentId(deps, request.params.id),
          userId: session.userId,
          sessionId: session.sessionId,
        })
        if (!result.ok) {
          throw new AppError(409, 'held', 'This document is locked by another editor', {
            holder: result.holder,
          })
        }
        return { lock: result.lock }
      },
    )

    app.post(
      '/api/documents/:id/lock/heartbeat',
      { preHandler: app.requireVerifiedSession, schema: { params: IdParams } },
      async (request) => {
        const session = requireAuthenticatedSession(request)
        const result = await editing.heartbeatLock({
          request,
          documentId: await resolveDocumentId(deps, request.params.id),
          sessionId: session.sessionId,
        })
        if (result.ok) {
          return { expiresAt: result.lock.expiresAt }
        }
        if (result.reason === 'released') {
          throw new AppError(404, 'released', 'This lock no longer exists')
        }
        if (result.reason === 'taken_over') {
          throw new AppError(409, 'taken_over', 'Someone else now holds this lock', {
            holder: result.holder,
          })
        }
        throw new AppError(410, 'expired', 'Your lock expired', { holder: result.holder })
      },
    )

    app.delete(
      '/api/documents/:id/lock',
      { preHandler: app.requireVerifiedSession, schema: { params: IdParams } },
      async (request, reply) => {
        const session = requireAuthenticatedSession(request)
        await editing.releaseLock({
          documentId: await resolveDocumentId(deps, request.params.id),
          sessionId: session.sessionId,
        })
        reply.status(204)
      },
    )

    app.post(
      '/api/documents/:id/lock/takeover',
      {
        // Taking a lock from its holder is disruptive by design, so it is
        // limited like the auth endpoints: per address, and per actor.
        config: addressRateLimit('lock-takeover'),
        preHandler: [
          app.requireVerifiedSession,
          accountRateLimit('lock-takeover', accountKeyFromSession),
        ],
        schema: { params: IdParams },
      },
      async (request) => {
        const session = requireAuthenticatedSession(request)
        const result = await editing.takeoverLock({
          request,
          documentId: await resolveDocumentId(deps, request.params.id),
          userId: session.userId,
          sessionId: session.sessionId,
        })
        return { lock: result.lock }
      },
    )
  }
}
