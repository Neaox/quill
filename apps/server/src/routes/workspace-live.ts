import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { createAuthorizer } from '@quill/application'
import type { SessionId } from '@quill/application'
import type { UserId } from '@quill/domain'
import type { FastifyPluginAsync } from 'fastify'

import { requireWorkspaceAccess } from '../application/authorization.ts'
import { resolveWorkspaceId } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'
import { AppError } from '../errors.ts'
import type { LiveAccess, LiveConnection, LiveMessage } from '../live/live-hub.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'
import { IdParamsSchema } from './document-schemas.ts'

/**
 * A workspace's live stream (ADR-063): `GET /api/workspaces/:id/events`,
 * server-sent events telling an open page when to read again — a sync
 * started or ended, a page's head moved, the tree changed.
 *
 * It is opened like any other read: a session, and `view` on the workspace,
 * or the refusal a reader without access gets everywhere (ADR-012); and only
 * for a workspace that reads from a repository (`409` otherwise). Each
 * message is then checked again, as the reader and at the moment it is sent
 * (`live-hub.ts`), so access lost while the stream is open stops it.
 *
 * The response is written by hand, past Fastify's reply: a stream has no end
 * for the compression and serialisation stages to wait for. The headers the
 * security plugin set on the request (ADR-011) are kept and sent with it.
 */

/** Asked of a browser by the stream itself: wait this long before opening it again. */
export const LIVE_RETRY_MS = 5_000

const tooManyStreams = () =>
  new AppError(
    429,
    'too_many_streams',
    'Too many live streams are open. Close another tab and reload.',
  )

const notStreaming = () =>
  new AppError(
    409,
    'workspace_not_sourced',
    'Only a workspace that reads from a repository has a live stream',
  )

function encode(message: LiveMessage): string {
  return `event: ${message.event}\ndata: ${JSON.stringify(message.data)}\n\n`
}

/** What one reader may see, asked afresh for each check, as them. */
function accessFor(
  deps: AppDependencies,
  reader: { readonly userId: UserId; readonly sessionId: SessionId },
): LiveAccess {
  const authorizer = () =>
    createAuthorizer(deps.uow.repos, { userId: reader.userId, shareLinkToken: null }, deps)
  return {
    // Signed out, or past its lifetime. Idleness is checked where it always
    // is, on the next request, which a stream makes when it reopens.
    async sessionAlive() {
      const session = await deps.uow.repos.sessions.findById(reader.sessionId)
      return session !== null && session.expiresAt.getTime() > deps.clock.now().getTime()
    },
    async canViewWorkspace(workspaceId) {
      const access = await authorizer().workspace(workspaceId)
      return access.ok && access.value.capabilities.view
    },
    async canViewDocument(documentId) {
      const access = await authorizer().document(documentId)
      return access.ok && access.value.capabilities.view
    },
  }
}

export function workspaceLiveRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()
    // Every stream ends before the server stops waiting for its requests.
    app.addHook('preClose', () => {
      deps.live.close()
    })

    app.get(
      '/api/workspaces/:id/events',
      {
        preHandler: app.requireSession,
        schema: {
          params: IdParamsSchema,
          response: {
            200: Type.String({
              description:
                'A text/event-stream: `sync`, `document`, `tree` and `reset` events, and keep-alive comments.',
            }),
          },
        },
      },
      async (request, reply) => {
        const session = requireAuthenticatedSession(request)
        const workspaceId = await resolveWorkspaceId(deps, request.params.id)
        const authorizer = createAuthorizer(
          deps.uow.repos,
          { userId: session.userId, shareLinkToken: null },
          deps,
        )
        const access = await requireWorkspaceAccess(authorizer, workspaceId, 'view')
        // Only a workspace that reads from a repository streams; a native one,
        // a disconnected one included, has nothing the stream would say.
        if (access.workspace.origin.kind !== 'sourced') throw notStreaming()

        const live = deps.live
        const raw = reply.raw
        let ended = false
        const connection: LiveConnection = {
          send(message) {
            raw.write(encode(message))
          },
          heartbeat() {
            raw.write(': keep-alive\n\n')
          },
          close() {
            ended = true
            raw.end()
          },
        }
        const opened = live.open(
          { key: session.userId, access: accessFor(deps, session) },
          workspaceId,
          connection,
        )
        if (opened.kind === 'full') throw tooManyStreams()

        reply.hijack()
        for (const [name, value] of Object.entries(reply.getHeaders()).filter(
          (header): header is [string, number | string | string[]] => header[1] !== undefined,
        )) {
          raw.setHeader(name, value)
        }
        raw.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          // A proxy that buffers responses would hold every event until the stream ends.
          'x-accel-buffering': 'no',
          // A stream is its connection: when it ends, so does the socket, and
          // nothing is left idle for the server to wait on when it stops.
          connection: 'close',
        })
        raw.write(`retry: ${LIVE_RETRY_MS}\n\n`)
        // The response's own close: the reader went away, or the connection dropped.
        raw.on('close', () => {
          if (!ended) opened.close()
        })
      },
    )
  }
}
