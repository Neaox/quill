import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  createCollection,
  deleteCollection,
  listCollections,
  renameCollection,
} from '@quill/application'
import type { CollectionId, CollectionRow } from '@quill/application'
import type { FastifyPluginAsync } from 'fastify'

import {
  authorizerFor,
  requireCollectionAccess,
  requireWorkspaceAccess,
} from '../application/authorization.ts'
import { resolveWorkspaceId } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'
import { conflict, notFound } from '../errors.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'

/**
 * Collections: create, rename, delete, list
 * (`docs/architecture/api-contract-m2.md`).
 *
 * A collection is a permission scope, not a folder (ADR-012), so the checks
 * are not all about the workspace: creating one is workspace administration,
 * while renaming or deleting one asks about that collection — which resolves
 * through the workspace above it anyway, and lets a grant made at the
 * collection answer for it. The rules about what a collection may become live
 * in the use cases; this layer decides who is allowed to ask.
 */

const CollectionSchema = Type.Object(
  {
    id: Type.String(),
    workspaceId: Type.String(),
    name: Type.String(),
    slug: Type.String(),
    createdAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'Collection' },
)

const CollectionNameBody = Type.Object({ name: Type.String({ minLength: 1, maxLength: 200 }) })
const WorkspaceIdParams = Type.Object({ id: Type.String() })
const CollectionIdParams = Type.Object({ id: Type.String() })

function collectionResponse(collection: CollectionRow): {
  id: string
  workspaceId: string
  name: string
  slug: string
  createdAt: string
} {
  return {
    id: collection.id,
    workspaceId: collection.workspaceId,
    name: collection.name,
    slug: collection.slug,
    createdAt: collection.createdAt.toISOString(),
  }
}

export function collectionRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()
    app.addSchema(CollectionSchema)

    /** For pickers: everything in the workspace, by name. Reading, so `view`. */
    app.get(
      '/api/workspaces/:id/collections',
      {
        preHandler: app.requireSession,
        schema: {
          params: WorkspaceIdParams,
          response: { 200: Type.Array(Type.Ref(CollectionSchema)) },
        },
      },
      async (request) => {
        const workspaceId = await resolveWorkspaceId(deps, request.params.id)
        await requireWorkspaceAccess(authorizerFor(deps, request), workspaceId, 'view')
        return (await listCollections(deps, { workspaceId })).map(collectionResponse)
      },
    )

    app.post(
      '/api/workspaces/:id/collections',
      {
        preHandler: app.requireVerifiedSession,
        schema: {
          params: WorkspaceIdParams,
          body: CollectionNameBody,
          response: { 201: Type.Ref(CollectionSchema) },
        },
      },
      async (request, reply) => {
        const workspaceId = await resolveWorkspaceId(deps, request.params.id)
        const session = requireAuthenticatedSession(request)
        await requireWorkspaceAccess(authorizerFor(deps, request), workspaceId, 'manage')

        const result = await createCollection(deps, {
          workspaceId,
          name: request.body.name,
          createdBy: session.userId,
        })
        if (result.kind === 'slug-taken') {
          throw conflict(
            'collection_slug_taken',
            'Another collection in this workspace already uses that name',
            { slug: result.slug },
          )
        }
        reply.status(201)
        return collectionResponse(result.collection)
      },
    )

    /**
     * Renaming changes the name and nothing else: the slug stays put, because
     * documents are addressed by id and nothing points at a collection by its
     * slug (AGENTS.md rule 8).
     */
    app.patch(
      '/api/collections/:id',
      {
        preHandler: app.requireVerifiedSession,
        schema: {
          params: CollectionIdParams,
          body: CollectionNameBody,
          response: { 200: Type.Ref(CollectionSchema) },
        },
      },
      async (request) => {
        const collectionId = request.params.id as CollectionId
        const session = requireAuthenticatedSession(request)
        await requireCollectionAccess(authorizerFor(deps, request), collectionId, 'manage')

        const result = await renameCollection(deps, {
          collectionId,
          name: request.body.name,
          renamedBy: session.userId,
        })
        /* v8 ignore next 2 -- the authorizer has already loaded this collection. */
        if (result.kind === 'not-found') throw notFound('Collection not found')
        return collectionResponse(result.collection)
      },
    )

    app.delete(
      '/api/collections/:id',
      { preHandler: app.requireVerifiedSession, schema: { params: CollectionIdParams } },
      async (request, reply) => {
        const collectionId = request.params.id as CollectionId
        const session = requireAuthenticatedSession(request)
        await requireCollectionAccess(authorizerFor(deps, request), collectionId, 'manage')

        const result = await deleteCollection(deps, { collectionId, deletedBy: session.userId })
        /* v8 ignore next 2 -- the authorizer has already loaded this collection. */
        if (result.kind === 'not-found') throw notFound('Collection not found')
        if (result.kind === 'not-empty') {
          // Deleting it would set `collection_id` null on every one of them,
          // which takes them out of the permission tree entirely (ADR-012).
          throw conflict(
            'collection_not_empty',
            'Move or delete this collection’s documents before deleting it',
            { documents: result.documents },
          )
        }
        reply.status(204)
      },
    )
  }
}
