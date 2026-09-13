import type { Clock, IdGenerator, SessionId, UnitOfWork } from '@quill/application'
import type { UserId } from '@quill/domain'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { createSessionService } from '../application/session-service.ts'
import type { SessionService } from '../application/session-service.ts'
import { readSessionCookie } from '../auth/session-cookie.ts'
import type { SessionConfig } from '../config.ts'
import { emailNotVerified, sessionExpired, unauthenticated } from '../errors.ts'

export interface AuthenticatedSession {
  readonly sessionId: SessionId
  readonly userId: UserId
}

declare module 'fastify' {
  interface FastifyRequest {
    session?: AuthenticatedSession
  }
  interface FastifyInstance {
    /** Attach as a route's `preHandler` to require a valid session; populates `request.session`. */
    requireSession(request: FastifyRequest, reply: FastifyReply): Promise<void>
    /**
     * `requireSession` plus ADR-011's "email verification is required before
     * a user can be granted anything beyond their own profile". Everything
     * that creates or changes tenancy, documents, drafts, or grants uses
     * this; `/api/me` and the auth routes use `requireSession`.
     */
    requireVerifiedSession(request: FastifyRequest, reply: FastifyReply): Promise<void>
    /** The session lifecycle, shared with the auth service so both agree on the clocks. */
    readonly sessions: SessionService
  }
}

export interface SessionSupportOptions {
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly session: SessionConfig
}

/**
 * Narrows `request.session` for a route registered with `requireSession` as
 * its `preHandler`. The `undefined` case is unreachable in practice — the
 * preHandler either populates it or throws first — but the type is optional
 * (any route could, in principle, omit the preHandler), so every caller
 * would otherwise repeat this same dead branch; centralising it here means
 * only one spot needs the coverage exclusion below, not one per route file.
 */
export function requireAuthenticatedSession(request: FastifyRequest): AuthenticatedSession {
  /* v8 ignore next 3 -- see doc comment above: only reachable by a route that forgets `preHandler: app.requireSession`. */
  if (request.session === undefined) {
    throw unauthenticated()
  }
  return request.session
}

/**
 * Decorates the app with `requireSession` and `requireVerifiedSession`
 * (ADR-011). Called directly against the root app instance rather than
 * registered as an encapsulated plugin, so the decorators are visible to
 * every route without depending on `fastify-plugin`, which is not a declared
 * dependency of this package.
 *
 * The cookie carries a token, not the row id: the lookup hashes it and the
 * session service applies the absolute and idle timeouts, so an expired
 * session is refused here rather than anywhere a route might forget.
 */
export function registerSessionSupport(app: FastifyInstance, options: SessionSupportOptions): void {
  const sessions = createSessionService({
    uow: options.uow,
    clock: options.clock,
    ids: options.ids,
    session: options.session,
  })

  app.decorateRequest('session', undefined)
  app.decorate('sessions', sessions)

  app.decorate(
    'requireSession',
    async function requireSession(request: FastifyRequest): Promise<void> {
      const token = readSessionCookie(request, options.session)
      if (token === undefined) {
        throw unauthenticated()
      }
      const result = await sessions.authenticate(token)
      if (!result.ok) {
        throw result.reason === 'expired' ? sessionExpired() : unauthenticated()
      }
      request.session = { sessionId: result.session.id, userId: result.session.userId }
    },
  )

  app.decorate(
    'requireVerifiedSession',
    async function requireVerifiedSession(
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> {
      await app.requireSession(request, reply)
      const session = requireAuthenticatedSession(request)
      const user = await options.uow.repos.users.findById(session.userId)
      /* v8 ignore next 3 -- unreachable: sessions.user_id cascades on delete (schema.ts), so a
         session that just authenticated always still has its user row. */
      if (user === null) {
        throw unauthenticated()
      }
      if (user.emailVerifiedAt === null) {
        throw emailNotVerified()
      }
    },
  )
}
