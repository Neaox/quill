import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  PersonPreferencesInputSchema,
  PersonPreferencesSchema,
  readPersonPreferences,
  updatePersonPreferences,
} from '@quill/application'
import type { FastifyPluginAsync } from 'fastify'

import type { AppDependencies } from '../dependencies.ts'
import { notFound } from '../errors.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'
import { strictValidator } from './strict-validator.ts'

/**
 * The signed-in person's own profile and preferences.
 *
 * Preferences need a session and not a verified email: they are the person's
 * own, and ADR-011 asks for verification only before anything beyond that.
 * The PUT is a state-changing request, so the cross-site check
 * (`plugins/csrf.ts`) applies to it like every other, and its body is held to
 * its schema strictly (`strict-validator.ts`).
 */
export function meRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()
    // A preference this release does not know is refused, not dropped.
    app.setValidatorCompiler(strictValidator())

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

    app.get(
      '/api/me/preferences',
      {
        preHandler: app.requireSession,
        schema: { response: { 200: PersonPreferencesSchema } },
      },
      async (request) => readPersonPreferences(deps, requireAuthenticatedSession(request).userId),
    )

    app.put(
      '/api/me/preferences',
      {
        preHandler: app.requireSession,
        schema: {
          body: PersonPreferencesInputSchema,
          response: { 200: PersonPreferencesSchema },
        },
      },
      async (request) =>
        updatePersonPreferences(deps, {
          userId: requireAuthenticatedSession(request).userId,
          preferences: request.body,
        }),
    )
  }
}
