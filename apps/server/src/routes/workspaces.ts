import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  childrenPage,
  createDocument,
  createWorkspace,
  deleteWorkspace,
  getWorkspaceTree,
  listVisibleDocuments,
  listVisibleWorkspaces,
  renameWorkspace,
  windowTree,
  type ChildrenOwner,
  type WindowedCollection,
  type WindowedNode,
} from '@quill/application'
import { collectionId, isUuid, slugify } from '@quill/domain'
import type { CollectionId, DocumentId } from '@quill/domain'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'

import {
  authorizerFor,
  isInstanceAdmin,
  requireInstanceAdmin,
  requireWorkspaceAccess,
} from '../application/authorization.ts'
import { resolveDocumentId, resolveWorkspaceId } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'
import { AppError, conflict, notFound, unprocessable } from '../errors.ts'
import { sessionRateLimit } from '../plugins/rate-limit.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'
import {
  CreateDocumentBodySchema,
  CreatedDocumentSchema,
  DocumentSchema,
  IdParamsSchema,
  TreeChildrenQuerySchema,
  TreeChildrenSchema,
  WorkspaceIdParamsSchema,
  WorkspaceTreeQuerySchema,
  WorkspaceTreeSchema,
  documentResponse,
  draftResponse,
} from './document-schemas.ts'

/** A sidebar's page: what `TREE_PAGE_SIZE` draws before "Show more". */
const TREE_PAGE_LIMIT = 50

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
/** A collection named by its id; anything else names none. */
function collectionOwner(reference: string): ChildrenOwner | undefined {
  return isUuid(reference)
    ? { kind: 'collection', collectionId: collectionId(reference) }
    : undefined
}

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

    /** The reader's whole tree: the one pass every cut of it is taken from. */
    /** The tree's reads walk the whole workspace, so a reader's budget bounds how often. */
    const treeBudget = sessionRateLimit('tree', deps.config.browseRateLimitMax)

    async function documentOwner(reference: string): Promise<ChildrenOwner | undefined> {
      const parentId = await resolveDocumentId(deps, reference).catch(() => undefined)
      return parentId === undefined ? undefined : { kind: 'document', parentId }
    }

    async function readerTree(request: FastifyRequest, workspace: string) {
      const target = await resolveWorkspaceId(deps, workspace)
      const authorizer = authorizerFor(deps, request)
      const access = await requireWorkspaceAccess(authorizer, target, 'view')
      const tree = await getWorkspaceTree(deps, {
        workspaceId: target,
        identities: await authorizer.identities(),
        seesEverything: access.isInstanceAdmin,
      })
      /* v8 ignore next 2 -- the authorizer has already walked this workspace's tree. */
      if (tree.kind !== 'tree') throw notFound('Workspace not found')
      return tree.collections
    }

    /*
     * Without `depth`, the whole tree, as it has always been answered. With
     * it, the tree a sidebar draws: that many levels, a page of each list,
     * and — with `focus` — the way down to the document being read, its page
     * of siblings at every level, and its own children (ADR-033: additive).
     */
    app.get(
      '/api/workspaces/:id/tree',
      {
        preHandler: app.requireSession,
        config: treeBudget,
        schema: {
          params: IdParamsSchema,
          querystring: WorkspaceTreeQuerySchema,
          response: { 200: WorkspaceTreeSchema },
        },
      },
      async (request) => {
        const collections = await readerTree(request, request.params.id)
        const { depth, limit, focus } = request.query
        const focused =
          focus === undefined
            ? undefined
            : // A focus that does not resolve simply opens nothing.
              await resolveDocumentId(deps, focus).catch(() => undefined)
        const windowed = windowTree(collections, {
          depth,
          limit: depth === undefined ? Number.POSITIVE_INFINITY : (limit ?? TREE_PAGE_LIMIT),
          focus: focused,
        })
        return { collections: windowed.map(toCollectionResponse) }
      },
    )

    /*
     * One page of a list in the tree: a collection's top level or a
     * document's children, each entry with its count. Cut from the same
     * reader-filtered tree, so a parent the reader cannot see is not found.
     */
    app.get(
      '/api/workspaces/:id/tree/children',
      {
        preHandler: app.requireSession,
        config: treeBudget,
        schema: {
          params: IdParamsSchema,
          querystring: TreeChildrenQuerySchema,
          response: { 200: TreeChildrenSchema },
        },
      },
      async (request) => {
        const { parent, collection, offset, limit } = request.query
        if ((parent === undefined) === (collection === undefined)) {
          throw new AppError(400, 'invalid_query', 'Name exactly one of parent and collection')
        }
        const collections = await readerTree(request, request.params.id)
        // A parent that names nothing, one in another workspace and one the
        // reader cannot see are all one answer, so the answer says nothing
        // about which documents exist (ADR-012).
        /* v8 ignore next -- `parent` is always given without a collection: the check above. */
        const owner = await (collection === undefined
          ? documentOwner(parent ?? '')
          : collectionOwner(collection))
        const page =
          owner === undefined ? undefined : childrenPage(collections, owner, { offset, limit })
        if (page === undefined || page.kind === 'not-found') {
          throw notFound('Not found in this workspace')
        }
        return { documents: page.documents.map(toTreeNode), total: page.total, offset: page.offset }
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

function toCollectionResponse(collection: WindowedCollection): CollectionResponse {
  return {
    id: collection.id,
    name: collection.name,
    slug: collection.slug,
    documents: collection.documents.map(toTreeNode),
    documentCount: collection.documentCount,
    documentsOffset: collection.documentsOffset,
    total: collection.total,
  }
}

interface CollectionResponse {
  id: string
  name: string
  slug: string
  documents: TreeNodeResponse[]
  documentCount: number
  documentsOffset: number
  total: number
}

interface TreeNodeResponse {
  id: string
  shortId: string
  title: string
  slug: string
  status: WindowedNode['status']
  children: TreeNodeResponse[]
  childCount: number
  childrenOffset: number
}

/** The slug travels derived from the title, exactly as it does on a document (ADR-035). */
function toTreeNode(node: WindowedNode): TreeNodeResponse {
  return {
    id: node.id,
    shortId: node.shortId,
    title: node.title,
    slug: slugify(node.title),
    status: node.status,
    children: node.children.map(toTreeNode),
    childCount: node.childCount,
    childrenOffset: node.childrenOffset,
  }
}
