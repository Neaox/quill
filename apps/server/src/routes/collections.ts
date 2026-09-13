import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  createCollection,
  deleteCollection,
  listCollections,
  publicSiteHref,
  publishCollection,
  renameCollection,
  unpublishCollection,
} from '@quill/application'
import type { CollectionId, CollectionRow } from '@quill/application'
import type { DocumentId } from '@quill/domain'
import type { FastifyPluginAsync } from 'fastify'

import {
  authorizerFor,
  requireCollectionAccess,
  requireWorkspaceAccess,
} from '../application/authorization.ts'
import { resolveWorkspaceId } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'
import { AppError, conflict, notFound, unprocessable } from '../errors.ts'
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
 *
 * Publishing a collection to the web (ADR-023) is here for the same reason:
 * it is a change to the collection, behind `manage` on it, and it is the only
 * JSON part of the public site — the pages themselves are HTML routes that no
 * client generated from this description ever calls
 * (`docs/architecture/public-site.md`).
 */

/** What a collection publishes, or null until it has ever been published. */
const PublicSiteSchema = Type.Union(
  [
    Type.Object(
      {
        enabled: Type.Boolean(),
        /** The address the site answers at: `<APP_URL>/s/<siteSlug>`. */
        siteSlug: Type.String(),
        /** The document the home shows; null for an index of the collection. */
        homeDocumentId: Type.Union([Type.String(), Type.Null()]),
        /** Pre-assembled, so a settings screen never builds a public URL by hand. */
        url: Type.String(),
      },
      { additionalProperties: false },
    ),
    Type.Null(),
  ],
  { $id: 'PublicSite' },
)

const CollectionSchema = Type.Object(
  {
    id: Type.String(),
    workspaceId: Type.String(),
    name: Type.String(),
    slug: Type.String(),
    createdAt: Type.String({ format: 'date-time' }),
    public: Type.Ref(PublicSiteSchema),
  },
  { $id: 'Collection' },
)

const PublishBodySchema = Type.Object({
  /** Defaults to the address it already had, then to the collection's own slug. */
  siteSlug: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  /** Omitted leaves the home as it was; `null` clears it back to an index. */
  homeDocumentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
})

const CollectionNameBody = Type.Object({ name: Type.String({ minLength: 1, maxLength: 200 }) })
const WorkspaceIdParams = Type.Object({ id: Type.String() })
const CollectionIdParams = Type.Object({ id: Type.String() })

interface CollectionResponse {
  id: string
  workspaceId: string
  name: string
  slug: string
  createdAt: string
  public: {
    enabled: boolean
    siteSlug: string
    homeDocumentId: string | null
    url: string
  } | null
}

function collectionResponse(collection: CollectionRow, appUrl: string): CollectionResponse {
  const site = collection.publicSite
  return {
    id: collection.id,
    workspaceId: collection.workspaceId,
    name: collection.name,
    slug: collection.slug,
    createdAt: collection.createdAt.toISOString(),
    public: site === null ? null : { ...site, url: `${appUrl}${publicSiteHref(site.siteSlug)}` },
  }
}

/**
 * The home document from a request body.
 *
 * Ajv coerces a JSON `null` to an empty string for a `string | null` field
 * before the null branch is tried, so "no home document" arrives as `null` or
 * as `''`, and both mean the same thing here — the same shape the share-link
 * route's expiry has.
 */
function readHomeDocumentId(value: string | null): DocumentId | null {
  return typeof value === 'string' && value.length > 0 ? (value as DocumentId) : null
}

export function collectionRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()
    app.addSchema(PublicSiteSchema)
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
        const rows = await listCollections(deps, { workspaceId })
        return rows.map((row) => collectionResponse(row, deps.config.appUrl))
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
        return collectionResponse(result.collection, deps.config.appUrl)
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
        return collectionResponse(result.collection, deps.config.appUrl)
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

    /**
     * Publish this collection to the web, or republish it at a new address
     * (ADR-023, use case 27).
     *
     * Behind `manage` on the collection, which is what workspace management
     * resolves to for a collection: whoever may grant access there may open
     * the door widest of all. Refused with its own code when the organisation
     * forbids publishing, because that is a statement about the organisation
     * rather than about the person, and a settings screen says so rather than
     * offering a switch that fails.
     */
    app.post(
      '/api/collections/:id/public',
      {
        preHandler: app.requireVerifiedSession,
        schema: {
          params: CollectionIdParams,
          body: PublishBodySchema,
          response: { 200: Type.Ref(CollectionSchema) },
        },
      },
      async (request) => {
        const collectionId = request.params.id as CollectionId
        const session = requireAuthenticatedSession(request)
        await requireCollectionAccess(authorizerFor(deps, request), collectionId, 'manage')

        const result = await publishCollection(deps, {
          collectionId,
          publishedBy: session.userId,
          ...(request.body.siteSlug === undefined ? {} : { siteSlug: request.body.siteSlug }),
          ...(request.body.homeDocumentId === undefined
            ? {}
            : { homeDocumentId: readHomeDocumentId(request.body.homeDocumentId) }),
        })

        switch (result.kind) {
          case 'published':
            // The site's address, its home and its navigation have all just
            // changed; the cache in front of it holds all three (ADR-023).
            deps.publicSiteCache.invalidate()
            return collectionResponse(result.collection, deps.config.appUrl)
          /* v8 ignore next 2 -- the authorizer has already loaded this collection. */
          case 'not-found':
            throw notFound('Collection not found')
          case 'not-allowed':
            throw new AppError(
              403,
              'public_publishing_disabled',
              'This organisation does not allow public publishing',
            )
          case 'slug-taken':
            throw conflict('public_site_slug_taken', 'Another collection is published there', {
              siteSlug: result.siteSlug,
            })
          case 'home-not-in-collection':
            throw unprocessable(
              'public_home_not_in_collection',
              'The home document must be in the collection being published',
            )
          case 'home-not-published':
            // Its own code rather than a silent fallback to the index: a
            // setting that is quietly ignored is one somebody debugs twice.
            throw unprocessable(
              'public_home_not_published',
              'The home document has not been published yet',
            )
          case 'settings-unreadable':
            throw new AppError(
              409,
              'settings_unreadable',
              'The organisation settings cannot be read, so its policies cannot be applied',
              { reason: result.reason, revision: result.revision },
            )
        }
      },
    )

    /**
     * Take the site down, keeping its address (ADR-023).
     *
     * Never refused by policy: an organisation that has turned publishing off
     * must still be able to take down what is already up.
     */
    app.delete(
      '/api/collections/:id/public',
      {
        preHandler: app.requireVerifiedSession,
        schema: { params: CollectionIdParams, response: { 200: Type.Ref(CollectionSchema) } },
      },
      async (request) => {
        const collectionId = request.params.id as CollectionId
        const session = requireAuthenticatedSession(request)
        await requireCollectionAccess(authorizerFor(deps, request), collectionId, 'manage')

        const result = await unpublishCollection(deps, {
          collectionId,
          unpublishedBy: session.userId,
        })
        /* v8 ignore next 2 -- the authorizer has already loaded this collection. */
        if (result.kind === 'not-found') throw notFound('Collection not found')
        if (result.kind === 'not-published') {
          throw conflict('public_site_not_published', 'This collection is not published')
        }
        // The site is down from this moment, not from the cache's next tick.
        deps.publicSiteCache.invalidate()
        return collectionResponse(result.collection, deps.config.appUrl)
      },
    )
  }
}
