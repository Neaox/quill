import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { createSourceReadCheck, readSourceFreshness } from '@quill/application'
import type { FastifyPluginAsync } from 'fastify'

import { authorizerFor, requireDocumentAccess } from '../application/authorization.ts'
import { resolveDocumentId } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'
import { IdParamsSchema } from './document-schemas.ts'

/**
 * Whether the document a reader has open is fresh (ADR-061, "Freshness"):
 * `GET /api/documents/:id/source-freshness`, asked when a document is opened
 * and again while it stays open.
 *
 * For a document in a sourced workspace it starts the check on read, without
 * waiting for it: the remote's head is compared at most once a minute per
 * source in this process, and a sync is asked for when the remote is ahead.
 * The answer is what the page needs to offer a reload and never to force
 * one: the revision the document is at now, and whether a sync is under way.
 * A reader is never told why a sync failed; the source's administrators are.
 */

const FreshnessSchema = Type.Object({
  /** Whether the document is read from a repository; when false, nothing here changes. */
  sourced: Type.Boolean(),
  /** The revision the document is published at now; null before its first. */
  revision: Type.Union([Type.String(), Type.Null()]),
  /** A sync of its source is running, or was asked for and is still to start. */
  syncing: Type.Boolean(),
})

export function sourceFreshnessRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()
    // This process's memory of when it last asked each source: one per app.
    const readCheck = createSourceReadCheck({
      uow: deps.uow,
      clock: deps.clock,
      sources: deps.sourceSync.sources,
    })

    app.get(
      '/api/documents/:id/source-freshness',
      {
        preHandler: app.requireSession,
        schema: { params: IdParamsSchema, response: { 200: FreshnessSchema } },
      },
      async (request) => {
        const access = await requireDocumentAccess(
          authorizerFor(deps, request),
          await resolveDocumentId(deps, request.params.id),
          'view',
        )
        const revision = access.document.headRevision
        if (access.workspace.origin.kind !== 'sourced') {
          return { sourced: false, revision, syncing: false }
        }
        const { syncing } = await readSourceFreshness(
          {
            uow: deps.uow,
            lock: deps.sourceSync.lock,
            readCheck,
            onCheckFailed: (error) => {
              request.log.warn({ err: error }, 'The check on read of a source failed')
            },
          },
          access.workspace.id,
        )
        return { sourced: true, revision, syncing }
      },
    )
  }
}
