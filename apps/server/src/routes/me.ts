import type { FastifyPluginAsync } from 'fastify'

import type { AppDependencies } from '../dependencies.ts'
import { notFound } from '../errors.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'

/** The signed-in user's own profile. */
export function meRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (app) => {
    app.get('/api/me', { preHandler: app.requireSession }, async (request) => {
      const session = requireAuthenticatedSession(request)
      const user = await deps.uow.repos.users.findById(session.userId)
      /* v8 ignore next 3 -- unreachable: sessions.user_id cascades on delete (schema.ts), so a valid session's user always exists. */
      if (user === null) {
        throw notFound('Signed-in user no longer exists')
      }
      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        emailVerified: user.emailVerifiedAt !== null,
        isInstanceAdmin: user.isInstanceAdmin,
      }
    })
  }
}
