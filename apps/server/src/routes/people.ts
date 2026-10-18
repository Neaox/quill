import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { namePeople, searchPeople } from '@quill/application'
import type { FastifyPluginAsync } from 'fastify'

import { authorizerFor, requireDocumentAccess } from '../application/authorization.ts'
import { resolveDocumentId } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'
import { sessionRateLimit } from '../plugins/rate-limit.ts'
import { IdParamsSchema } from './document-schemas.ts'

/**
 * `GET /api/documents/:id/people`: the people directory behind the owner
 * picker in the properties line (`docs/design/properties.md`).
 *
 * Scoped to a document, and open only to someone who may edit it, because the
 * only reason to look a person up is to name them on a document you are
 * writing: a directory any member could page through would be an address book
 * of the whole instance. So it answers only for verified people who can view
 * that document, by search or by address alike (`use-cases/document-facts.ts`);
 * anyone else is neither found nor named. `q` searches names and addresses,
 * from two characters; `email` (repeated) names the addresses a document
 * already holds, all of them in one request. Each caller has a budget, so the
 * directory cannot be walked a query at a time either.
 */

const PeopleQuerySchema = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 200 })),
  email: Type.Optional(
    Type.Union([
      Type.String({ maxLength: 320 }),
      Type.Array(Type.String({ maxLength: 320 }), { maxItems: 50 }),
    ]),
  ),
})

export const PersonSchema = Type.Object({
  /** What front matter holds for this person: their address. */
  value: Type.String(),
  name: Type.String(),
  detail: Type.String(),
})

const PeopleSchema = Type.Object({ people: Type.Array(PersonSchema) })

export function peopleRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    app.get(
      '/api/documents/:id/people',
      {
        preHandler: app.requireVerifiedSession,
        config: sessionRateLimit('people-directory', deps.config.searchRateLimitMax),
        schema: {
          params: IdParamsSchema,
          querystring: PeopleQuerySchema,
          response: { 200: PeopleSchema },
        },
      },
      async (request) => {
        const documentId = await resolveDocumentId(deps, request.params.id)
        await requireDocumentAccess(authorizerFor(deps, request), documentId, 'edit')
        const { q, email } = request.query
        if (email !== undefined) {
          const emails = typeof email === 'string' ? [email] : email
          return { people: [...(await namePeople(deps, documentId, emails))] }
        }
        return { people: [...(await searchPeople(deps, documentId, q ?? ''))] }
      },
    )
  }
}
