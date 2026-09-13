import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  createDocument,
  createWorkspace,
  deleteWorkspace,
  getWorkspaceTree,
  listVisibleDocuments,
  listVisibleWorkspaces,
  renameWorkspace,
} from '@quill/application'
import { slugify } from '@quill/domain'
import type { CollectionId, DocumentId } from '@quill/domain'
import type { FastifyPluginAsync } from 'fastify'

import {
  authorizerFor,
  isInstanceAdmin,
  requireInstanceAdmin,
  requireWorkspaceAccess,
} from '../application/authorization.ts'
import { resolveWorkspaceId } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'
import { AppError, conflict, notFound, unprocessable } from '../errors.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'
import {
  CreateDocumentBodySchema,
  CreatedDocumentSchema,
  DocumentSchema,
  IdParamsSchema,
  WorkspaceIdParamsSchema,
  WorkspaceTreeSchema,
  documentResponse,
  draftResponse,
} from './document-schemas.ts'

const CreateWorkspaceBody = Type.Object({
  unitId: Type.String(),
  name: Type.String({ minLength: 1 }),
  slug: Type.String({ minLength: 1, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' }),
})

/**
 * `slug` is optional and additive (ADR-033): omitting it leaves the slug
 * where it is, which is what a rename has always done. Giving one moves the
 * workspace's address and leaves the old slug redirecting for a year
 * (ADR-035).
 */
const RenameWorkspaceBody = Type.Object({
  name: Type.String({ minLength: 1 }),
  slug: Type.Optional(Type.String({ minLength: 1, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' })),
})

const WorkspaceSchema = Type.Object({
  id: Type.String(),
  unitId: Type.String(),
  name: Type.String(),
  slug: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
})

/** The owning unit, named so a picker can group without a second request. */
const UnitSummarySchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  /** That unit and every unit above it, root first. */
  path: Type.Array(Type.String()),
})

/** `WorkspaceSchema` plus the owning unit: the shape `GET /api/workspaces` lists. */
const WorkspaceListItemSchema = Type.Object({
  id: Type.String(),
  unitId: Type.String(),
  name: Type.String(),
  slug: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  unit: UnitSummarySchema,
})

/**
 * Workspaces, and the navigation and creation routes that hang off them
 * (`docs/architecture/api-contract-m2.md`).
 *
 * Creating a workspace is instance administration, because it attaches a body
 * of documentation to a unit. Everything inside one is resolved through the
 * permission resolver: reading the tree needs view, creating a document needs
 * edit, and renaming or deleting the workspace needs manage.
 */
export function workspaceRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    /**
     * Every workspace the caller can reach, for the picker. Visibility is
     * decided by the same resolver a direct read uses, so the list can never
     * offer a workspace `GET /api/workspaces/:id` would refuse (ADR-012).
     */
    app.get(
      '/api/workspaces',
      {
        preHandler: app.requireSession,
        schema: { response: { 200: Type.Array(WorkspaceListItemSchema) } },
      },
      async (request) => {
        const authorizer = authorizerFor(deps, request)
        const visible = await listVisibleWorkspaces(deps, {
          identities: await authorizer.identities(),
          seesEverything: await isInstanceAdmin(deps, request),
        })
        return visible.workspaces.map(({ workspace, unit, unitPath }) => ({
          id: workspace.id,
          unitId: workspace.unitId,
          name: workspace.name,
          slug: workspace.slug,
          createdAt: workspace.createdAt.toISOString(),
          unit: { id: unit.id, name: unit.name, path: [...unitPath] },
        }))
      },
    )

    app.post(
      '/api/workspaces',
      {
        preHandler: app.requireVerifiedSession,
        schema: { body: CreateWorkspaceBody, response: { 201: WorkspaceSchema } },
      },
      async (request, reply) => {
        await requireInstanceAdmin(deps, request)
        const session = requireAuthenticatedSession(request)
        const result = await createWorkspace(deps, {
          unitId: request.body.unitId,
          name: request.body.name,
          slug: request.body.slug,
          createdBy: session.userId,
        })
        if (result.kind === 'unit-not-found') throw notFound('That unit does not exist')
        if (result.kind === 'slug-taken') {
          // The slug is what a published site is addressed by, so it is unique
          // across the instance rather than within a unit.
          throw conflict('workspace_slug_taken', 'Another workspace already uses that slug', {
            slug: result.slug,
          })
        }
        reply.status(201)
        return {
          ...result.workspace,
          createdAt: result.workspace.createdAt.toISOString(),
        }
      },
    )

    app.get(
      '/api/workspaces/:id',
      {
        preHandler: app.requireSession,
        schema: { params: IdParamsSchema, response: { 200: WorkspaceSchema } },
      },
      async (request) => {
        const access = await requireWorkspaceAccess(
          authorizerFor(deps, request),
          await resolveWorkspaceId(deps, request.params.id),
          'view',
        )
        return { ...access.workspace, createdAt: access.workspace.createdAt.toISOString() }
      },
    )

    app.patch(
      '/api/workspaces/:id',
      {
        preHandler: app.requireVerifiedSession,
        schema: {
          params: IdParamsSchema,
          body: RenameWorkspaceBody,
          response: { 200: WorkspaceSchema },
        },
      },
      async (request) => {
        const target = await resolveWorkspaceId(deps, request.params.id)
        const session = requireAuthenticatedSession(request)
        await requireWorkspaceAccess(authorizerFor(deps, request), target, 'manage')
        const result = await renameWorkspace(deps, {
          workspaceId: target,
          name: request.body.name,
          ...(request.body.slug === undefined ? {} : { slug: request.body.slug }),
          renamedBy: session.userId,
        })
        /* v8 ignore next 2 -- the authorizer has already loaded this workspace. */
        if (result.kind === 'not-found') throw notFound('Workspace not found')
        if (result.kind === 'slug-taken') {
          throw conflict('workspace_slug_taken', 'Another workspace already uses that slug', {
            slug: result.slug,
          })
        }
        return {
          ...result.workspace,
          createdAt: result.workspace.createdAt.toISOString(),
        }
      },
    )

    app.delete(
      '/api/workspaces/:id',
      { preHandler: app.requireVerifiedSession, schema: { params: IdParamsSchema } },
      async (request, reply) => {
        const target = await resolveWorkspaceId(deps, request.params.id)
        const session = requireAuthenticatedSession(request)
        await requireWorkspaceAccess(authorizerFor(deps, request), target, 'manage')
        const result = await deleteWorkspace(deps, {
          workspaceId: target,
          deletedBy: session.userId,
        })
        /* v8 ignore next 2 -- the authorizer has already loaded this workspace. */
        if (result.kind === 'not-found') throw notFound('Workspace not found')
        reply.status(204)
      },
    )

    app.get(
      '/api/workspaces/:id/tree',
      {
        preHandler: app.requireSession,
        schema: { params: IdParamsSchema, response: { 200: WorkspaceTreeSchema } },
      },
      async (request) => {
        const target = await resolveWorkspaceId(deps, request.params.id)
        const authorizer = authorizerFor(deps, request)
        const access = await requireWorkspaceAccess(authorizer, target, 'view')
        const tree = await getWorkspaceTree(deps, {
          workspaceId: target,
          identities: await authorizer.identities(),
          seesEverything: access.isInstanceAdmin,
        })
        /* v8 ignore next 2 -- the authorizer has already walked this workspace's tree. */
        if (tree.kind !== 'tree') throw notFound('Workspace not found')
        return { collections: tree.collections.map(toCollectionResponse) }
      },
    )

    app.get(
      '/api/workspaces/:workspaceId/documents',
      {
        preHandler: app.requireSession,
        schema: {
          params: WorkspaceIdParamsSchema,
          response: { 200: Type.Array(DocumentSchema) },
        },
      },
      async (request) => {
        const target = await resolveWorkspaceId(deps, request.params.workspaceId)
        const authorizer = authorizerFor(deps, request)
        const access = await requireWorkspaceAccess(authorizer, target, 'view')
        // The flat list resolves each document exactly as the tree does, so a
        // document a deny hides from the tree is not handed over here instead.
        const visible = await listVisibleDocuments(deps, {
          workspaceId: target,
          identities: await authorizer.identities(),
          seesEverything: access.isInstanceAdmin,
        })
        /* v8 ignore next 2 -- the authorizer has already walked this workspace's tree. */
        if (visible.kind !== 'documents') throw notFound('Workspace not found')
        return visible.documents.map(documentResponse)
      },
    )

    app.post(
      '/api/workspaces/:workspaceId/documents',
      {
        preHandler: app.requireVerifiedSession,
        schema: {
          params: WorkspaceIdParamsSchema,
          body: CreateDocumentBodySchema,
          response: { 201: CreatedDocumentSchema },
        },
      },
      async (request, reply) => {
        const target = await resolveWorkspaceId(deps, request.params.workspaceId)
        await requireWorkspaceAccess(authorizerFor(deps, request), target, 'edit')
        const session = requireAuthenticatedSession(request)

        const created = await createDocument(deps, {
          workspaceId: target,
          collectionId: request.body.collectionId as CollectionId,
          parentId: (request.body.parentId as DocumentId | undefined) ?? null,
          title: request.body.title,
          createdBy: session.userId,
          ...(request.body.templateId === undefined
            ? {}
            : { templateId: request.body.templateId as DocumentId }),
          ...(request.body.answers === undefined ? {} : { answers: request.body.answers }),
        })

        switch (created.kind) {
          case 'created':
            reply.status(201)
            return {
              document: documentResponse(created.document),
              draft: draftResponse(created.draft),
              requiredSections: [...created.requiredSections],
              warnings: [...created.warnings],
            }
          case 'collection-not-found':
            throw notFound('That collection does not exist in this workspace')
          case 'parent-not-found':
            throw conflict(
              'parent_not_found',
              'That parent document does not exist in this collection',
            )
          case 'template-not-found':
            throw notFound('That template has not been published')
          case 'short-id-unavailable':
            // Five keys in a row already taken is not something a healthy
            // instance produces (ADR-035): the request was fine, so this is
            // the platform's fault to report and to look into.
            throw new AppError(
              500,
              'short_id_unavailable',
              'Could not allocate a short id for this document; please try again',
              { attempts: created.attempts },
            )
          case 'path-unavailable':
            // Every path this title could take is held by another document
            // (`MAX_PATH_ATTEMPTS`). Renaming is the way out, so it is the
            // request that cannot be processed rather than a server fault.
            throw unprocessable(
              'path_unavailable',
              'Too many documents in this collection share that title; give this one a different one',
              { attempts: created.attempts },
            )
        }
      },
    )
  }
}

function toCollectionResponse(collection: {
  id: string
  name: string
  slug: string
  documents: readonly TreeNodeView[]
}): { id: string; name: string; slug: string; documents: TreeNodeResponse[] } {
  return {
    id: collection.id,
    name: collection.name,
    slug: collection.slug,
    documents: collection.documents.map(toTreeNode),
  }
}

interface TreeNodeView {
  readonly id: string
  readonly shortId: string
  readonly title: string
  readonly slug: string
  readonly status: ReturnType<typeof documentResponse>['status']
  readonly children: readonly TreeNodeView[]
}

interface TreeNodeResponse {
  id: string
  shortId: string
  title: string
  slug: string
  status: TreeNodeView['status']
  children: TreeNodeResponse[]
}

/** The slug travels derived from the title, exactly as it does on a document (ADR-035). */
function toTreeNode(node: TreeNodeView): TreeNodeResponse {
  return {
    id: node.id,
    shortId: node.shortId,
    title: node.title,
    slug: slugify(node.title),
    status: node.status,
    children: node.children.map(toTreeNode),
  }
}
