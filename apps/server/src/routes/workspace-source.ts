import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  configureWorkspaceSource,
  getWorkspaceSource,
  requestManualSourceSync,
} from '@quill/application'
import type { WorkspaceSourceView } from '@quill/application'
import { SOURCE_COMMIT_MESSAGE_SETTINGS, SOURCE_HISTORY_SETTINGS } from '@quill/domain'
import type { FastifyPluginAsync } from 'fastify'

import {
  authorizerFor,
  requireInstanceAdmin,
  requireWorkspaceAccess,
} from '../application/authorization.ts'
import { resolveWorkspaceId } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'
import { conflict, notFound, unprocessable } from '../errors.ts'
import type { AppError } from '../errors.ts'
import { sessionRateLimit } from '../plugins/rate-limit.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'
import { IdParamsSchema } from './document-schemas.ts'

/**
 * A workspace's external source (ADR-061): where it reads from, how far it has
 * synced, and "Sync now".
 *
 * **Configuring a source is instance administration.** A source's credential
 * names a secret of the whole instance (ADR-034) and is sent to the remote the
 * source names, so whoever may configure one could send any secret to a
 * server of their choosing. Reading the source and asking for a sync need
 * only `manage` of the workspace, which ADR-061 leaves on in a sourced
 * workspace: neither sends anything anywhere new.
 */

/** "Sync now" presses a person may make in the rate limiter's window. */
const SYNC_REQUESTS_PER_WINDOW = 10

const SourceCollectionSchema = Type.Object({
  slug: Type.String({ minLength: 1, maxLength: 80 }),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  /** A directory or a file in the repository, relative to its root. */
  path: Type.String({ minLength: 1, maxLength: 1024 }),
})

const CredentialSchema = Type.Object({
  username: Type.String({ minLength: 1, maxLength: 256 }),
  /** The name of a secret in the secrets store, never its value (ADR-034). */
  secretName: Type.String({ minLength: 1, maxLength: 200 }),
})

const ConfigureSourceBody = Type.Object(
  {
    remote: Type.String({ minLength: 1, maxLength: 2048 }),
    branch: Type.String({ minLength: 1, maxLength: 255 }),
    collections: Type.Array(SourceCollectionSchema, { minItems: 1, maxItems: 100 }),
    history: Type.Union(SOURCE_HISTORY_SETTINGS.map((setting) => Type.Literal(setting))),
    commitMessages: Type.Union(
      SOURCE_COMMIT_MESSAGE_SETTINGS.map((setting) => Type.Literal(setting)),
    ),
    credential: Type.Union([CredentialSchema, Type.Null()]),
    /**
     * The name of the secret the source's push webhook is signed with (ADR-034),
     * never its value; null for no webhook, omitted to keep what the source has.
     */
    webhookSecret: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]),
    ),
  },
  { additionalProperties: false },
)

const SyncFailureSchema = Type.Object({
  reason: Type.String(),
  message: Type.String(),
  revision: Type.Union([Type.String(), Type.Null()]),
})

const RefusedFileSchema = Type.Object({
  path: Type.String(),
  revision: Type.String(),
  reason: Type.String(),
})

const WorkspaceSourceSchema = Type.Object({
  remote: Type.String(),
  branch: Type.String(),
  collections: Type.Array(
    Type.Object({
      collectionId: Type.String(),
      slug: Type.String(),
      name: Type.String(),
      path: Type.String(),
    }),
  ),
  history: Type.String(),
  commitMessages: Type.String(),
  credential: Type.Union([CredentialSchema, Type.Null()]),
  /** The name of the secret its push webhook is signed with; null when it takes no webhook. */
  webhookSecret: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.String({ format: 'date-time' }),
  /** How far it has synced; null before the first attempt. */
  sync: Type.Union([
    Type.Object({
      lastSyncedRevision: Type.Union([Type.String(), Type.Null()]),
      lastSyncedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
      lastAttemptAt: Type.String({ format: 'date-time' }),
      failure: Type.Union([SyncFailureSchema, Type.Null()]),
      refused: Type.Array(RefusedFileSchema),
    }),
    Type.Null(),
  ]),
})

const SyncRequestedSchema = Type.Object({ requested: Type.Boolean() })

type WorkspaceSourceResponse = Static<typeof WorkspaceSourceSchema>

function sourceResponse({
  source,
  collections,
  state,
}: WorkspaceSourceView): WorkspaceSourceResponse {
  return {
    remote: source.remote,
    branch: source.branch,
    collections: collections.map(({ collectionId, slug, name, path }) => ({
      collectionId,
      slug,
      name,
      path,
    })),
    history: source.history,
    commitMessages: source.commitMessages,
    credential: source.credential,
    webhookSecret: source.webhookSecretName,
    updatedAt: source.updatedAt.toISOString(),
    sync:
      state === null
        ? null
        : {
            lastSyncedRevision: state.lastSyncedRevision,
            lastSyncedAt: state.lastSyncedAt?.toISOString() ?? null,
            lastAttemptAt: state.lastAttemptAt.toISOString(),
            failure: state.failure,
            refused: [...state.refused],
          },
  }
}

const notSourced = (): AppError =>
  conflict('workspace_not_sourced', 'This workspace does not read from a repository')

export function workspaceSourceRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    app.get(
      '/api/workspaces/:id/source',
      {
        preHandler: app.requireSession,
        schema: { params: IdParamsSchema, response: { 200: WorkspaceSourceSchema } },
      },
      async (request) => {
        const target = await resolveWorkspaceId(deps, request.params.id)
        await requireWorkspaceAccess(authorizerFor(deps, request), target, 'manage')
        const view = await getWorkspaceSource(deps, target)
        if (view === null) throw notSourced()
        return sourceResponse(view)
      },
    )

    app.put(
      '/api/workspaces/:id/source',
      {
        preHandler: app.requireVerifiedSession,
        schema: {
          params: IdParamsSchema,
          body: ConfigureSourceBody,
          response: { 200: WorkspaceSourceSchema },
        },
      },
      async (request) => {
        // Before the workspace is resolved, so nobody else learns which exist.
        await requireInstanceAdmin(deps, request)
        const target = await resolveWorkspaceId(deps, request.params.id)
        const session = requireAuthenticatedSession(request)
        const { webhookSecret, ...settings } = request.body
        const result = await configureWorkspaceSource(
          { ...deps, allowFileRemotes: deps.sourceSync.allowFileRemotesForTesting },
          {
            ...settings,
            webhookSecretName: webhookSecret,
            workspaceId: target,
            configuredBy: session.userId,
          },
        )
        switch (result.kind) {
          case 'configured':
            return sourceResponse(result.view)
          /* v8 ignore next 2 -- the workspace was resolved a moment ago. */
          case 'not-found':
            throw notFound('Workspace not found')
          case 'not-empty':
            throw conflict(
              'workspace_not_empty',
              'Only a workspace with no documents can be made to read from a repository',
            )
          case 'invalid':
            throw unprocessable('invalid_source', result.message, { field: result.field })
        }
      },
    )

    app.post(
      '/api/workspaces/:id/source/sync',
      {
        preHandler: app.requireVerifiedSession,
        config: sessionRateLimit('source-sync', SYNC_REQUESTS_PER_WINDOW),
        schema: { params: IdParamsSchema, response: { 202: SyncRequestedSchema } },
      },
      async (request, reply) => {
        const target = await resolveWorkspaceId(deps, request.params.id)
        await requireWorkspaceAccess(authorizerFor(deps, request), target, 'manage')
        const session = requireAuthenticatedSession(request)
        const result = await requestManualSourceSync(deps, {
          workspaceId: target,
          requestedBy: session.userId,
        })
        if (result.kind === 'not-sourced') throw notSourced()
        // Accepted, not done: the sync runs on the job runner, off this request.
        reply.status(202)
        return { requested: true }
      },
    )
  }
}
