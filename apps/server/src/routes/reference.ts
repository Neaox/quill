import { Readable } from 'node:stream'

import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { latestReference, listReferenceSnapshots, openReferenceArtifact } from '@quill/application'
import type { ReferenceSnapshotRow } from '@quill/application'
import type { WorkspaceId } from '@quill/domain'
import type { FastifyPluginAsync } from 'fastify'

import { authorizerFor, requireWorkspaceAccess } from '../application/authorization.ts'
import { resolveWorkspaceId } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'
import { notFound } from '../errors.ts'

/**
 * The reference index's read surface (ADR-065): the snapshot a workspace
 * currently serves, its history, and the artifact's bytes.
 *
 * The artifact is served as its own response rather than embedded in the
 * metadata, because a code index is tens of megabytes and the page decides
 * whether it needs it. Both routes ask for `view` on the workspace: the
 * reference is documentation of that workspace, not a second permission
 * model.
 *
 * A snapshot id is checked against the workspace and kind in the path, so a
 * member of one workspace cannot read another's artifact by naming its id.
 */

const Kind = Type.Union([Type.Literal('code'), Type.Literal('schema')])

const ReferenceParamsSchema = Type.Object({ id: Type.String(), kind: Kind })

const ArtifactQuerySchema = Type.Object({ snapshot: Type.String({ minLength: 1 }) })

const SnapshotSchema = Type.Object({
  id: Type.String(),
  kind: Kind,
  /** The commit the artifact was produced from. */
  sourceCommit: Type.String(),
  /** When the producer read the source, not when this row was written. */
  capturedAt: Type.String({ format: 'date-time' }),
  artifactVersion: Type.Integer(),
  artifactSize: Type.Integer(),
  symbolCount: Type.Integer(),
  tableCount: Type.Integer(),
  /** Where the bytes are; the page fetches this separately. */
  artifactUrl: Type.String(),
})

const ReferenceSchema = Type.Object({
  /** Null before the workspace's first ingestion of this kind. */
  latest: Type.Union([SnapshotSchema, Type.Null()]),
  /** Newest first, at most 20. */
  history: Type.Array(SnapshotSchema),
})

function response(workspaceId: WorkspaceId, row: ReferenceSnapshotRow) {
  return {
    id: row.id,
    kind: row.kind,
    sourceCommit: row.sourceCommit,
    capturedAt: row.capturedAt.toISOString(),
    artifactVersion: row.artifactVersion,
    artifactSize: row.artifactSize,
    symbolCount: row.symbolCount,
    tableCount: row.tableCount,
    artifactUrl: `/api/workspaces/${workspaceId}/reference/${row.kind}/artifact?snapshot=${row.id}`,
  }
}

export function referenceRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    app.get(
      '/api/workspaces/:id/reference/:kind',
      {
        preHandler: app.requireSession,
        schema: { params: ReferenceParamsSchema, response: { 200: ReferenceSchema } },
      },
      async (request) => {
        const workspaceId = await resolveWorkspaceId(deps, request.params.id)
        await requireWorkspaceAccess(authorizerFor(deps, request), workspaceId, 'view')
        const [latest, history] = await Promise.all([
          latestReference(deps, workspaceId, request.params.kind),
          listReferenceSnapshots(deps, workspaceId, request.params.kind),
        ])
        return {
          latest: latest === null ? null : response(workspaceId, latest),
          history: history.map((row) => response(workspaceId, row)),
        }
      },
    )

    app.get(
      '/api/workspaces/:id/reference/:kind/artifact',
      {
        preHandler: app.requireSession,
        schema: {
          params: ReferenceParamsSchema,
          querystring: ArtifactQuerySchema,
          response: { 200: Type.Unknown() },
        },
      },
      async (request, reply) => {
        const workspaceId = await resolveWorkspaceId(deps, request.params.id)
        await requireWorkspaceAccess(authorizerFor(deps, request), workspaceId, 'view')
        const snapshot = await deps.uow.repos.referenceSnapshots.findById(request.query.snapshot)
        if (
          snapshot === null ||
          snapshot.workspaceId !== workspaceId ||
          snapshot.kind !== request.params.kind
        ) {
          throw notFound('No such reference snapshot')
        }
        const body = await openReferenceArtifact(deps, snapshot)
        if (body === null) {
          throw notFound('That snapshot’s artifact is no longer stored')
        }
        void reply.type('application/json; charset=utf-8')
        void reply.header('cache-control', 'private, max-age=3600, immutable')
        return reply.send(Readable.from(body))
      },
    )
  }
}
