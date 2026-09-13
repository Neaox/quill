import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  getDiff,
  getEnvelope,
  getHistory,
  publishDocument,
  readPublished,
  deleteDocument,
  renderDocument,
  restoreRevision,
  updateDocument,
} from '@quill/application'
import type { CollectionId, PublishAuthor } from '@quill/application'
import { revisionId } from '@quill/domain'
import type { DocumentId, DocumentStatus, RevisionId } from '@quill/domain'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'

import {
  authorizerFor,
  requireCollectionAccess,
  requireDocumentAccess,
} from '../application/authorization.ts'
import { resolveDocumentId } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'
import { conflict, lockLost, notFound, unprocessable } from '../errors.ts'
import { notModified } from '../errors.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'
import {
  ContentSchema,
  documentResponse,
  envelopeResponse,
  historyResponse,
  DiffQuerySchema,
  DiffSchema,
  DocumentSchema,
  EnvelopeSchema,
  HistoryQuerySchema,
  HistorySchema,
  IdParamsSchema,
  MergeRequiredSchema,
  PublishBodySchema,
  PublishedSchema,
  RenderedQuerySchema,
  RenderedSchema,
  RestoreBodySchema,
} from './document-schemas.ts'
import { DocumentStatusSchema } from './document-schemas.ts'

/**
 * Every field optional; an omitted field is left alone.
 *
 * `parentId` also accepts `null`, which is how a document is lifted to the
 * root of its collection — a distinct instruction from omitting the field,
 * and additive to what the schema accepted before (ADR-033).
 */
const UpdateDocumentBody = Type.Partial(
  Type.Object({
    title: Type.String({ minLength: 1 }),
    slug: Type.String({ minLength: 1 }),
    path: Type.String({ minLength: 1 }),
    status: DocumentStatusSchema,
    collectionId: Type.String({ minLength: 1 }),
    parentId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  }),
)

/**
 * The document half of the M2 content API
 * (`docs/architecture/api-contract-m2.md`).
 *
 * Every route authorises through the one resolver (ADR-012) and then calls a
 * use case; nothing here reaches for a repository or decides what a role may
 * do. Publish and restore are the only writes to the content store (ADR-015),
 * and the rendered body is served from the cache with an ETag of the revision
 * and the render version (ADR-031).
 */
export function documentRoutes(deps: AppDependencies): FastifyPluginAsync {
  const author = async (request: FastifyRequest): Promise<PublishAuthor> => {
    const session = requireAuthenticatedSession(request)
    const user = await deps.uow.repos.users.findById(session.userId)
    /* v8 ignore next -- sessions cascade with their user, so a valid session always has one. */
    if (user === null) throw notFound('Signed-in user no longer exists')
    return { userId: user.id, name: user.displayName, email: user.email }
  }

  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    app.get(
      '/api/documents/:id',
      {
        preHandler: app.requireSession,
        schema: { params: IdParamsSchema, response: { 200: DocumentSchema } },
      },
      async (request) => {
        const access = await requireDocumentAccess(
          authorizerFor(deps, request),
          await resolveDocumentId(deps, request.params.id),
          'view',
        )
        return documentResponse(access.document)
      },
    )

    app.get(
      '/api/documents/:id/content',
      {
        preHandler: app.requireSession,
        schema: { params: IdParamsSchema, response: { 200: ContentSchema } },
      },
      async (request) => {
        const documentId = await resolveDocumentId(deps, request.params.id)
        await requireDocumentAccess(authorizerFor(deps, request), documentId, 'view')
        const published = await readPublished(deps, { documentId })
        if (published.kind !== 'found') throw notFound('This document has not been published yet')
        return {
          revision: published.revision,
          markdown: published.markdown,
          frontMatter: published.frontMatter,
        }
      },
    )

    app.get(
      '/api/documents/:id/rendered',
      {
        preHandler: app.requireSession,
        schema: {
          params: IdParamsSchema,
          querystring: RenderedQuerySchema,
          response: { 200: RenderedSchema },
        },
      },
      async (request, reply) => {
        const documentId = await resolveDocumentId(deps, request.params.id)
        await requireDocumentAccess(authorizerFor(deps, request), documentId, 'view')
        const rendered = await renderDocument(deps, {
          documentId,
          revision: request.query.revision as RevisionId | undefined,
        })
        if (rendered.kind !== 'rendered') {
          throw notFound('This document has not been published yet')
        }

        // The render-cache key is the whole of the body's identity: the hash
        // of everything it was rendered from — its Markdown and the titles of
        // the documents it links to — and the render version (ADR-031). A
        // rename in a document this one links to therefore changes the tag,
        // which a tag of the revision alone would not.
        const etag = `"${rendered.key}"`
        reply.header('etag', etag)
        reply.header('cache-control', 'private, no-cache')
        if (request.headers['if-none-match'] === etag) throw notModified()

        return {
          revision: rendered.revision,
          html: rendered.content.html,
          outline: [...rendered.content.outline],
          slots: [...rendered.content.slots],
        }
      },
    )

    app.get(
      '/api/documents/:id/envelope',
      {
        preHandler: app.requireSession,
        schema: { params: IdParamsSchema, response: { 200: EnvelopeSchema } },
      },
      async (request) => {
        const documentId = await resolveDocumentId(deps, request.params.id)
        const access = await requireDocumentAccess(authorizerFor(deps, request), documentId, 'view')
        const envelope = await getEnvelope(deps, {
          documentId,
          capabilities: access.capabilities,
        })
        /* v8 ignore next -- the authorizer has already loaded this document. */
        if (envelope.kind !== 'envelope') throw notFound('Document not found')
        return envelopeResponse(envelope.envelope)
      },
    )

    app.post(
      '/api/documents/:id/publish',
      {
        preHandler: app.requireVerifiedSession,
        schema: {
          params: IdParamsSchema,
          body: PublishBodySchema,
          response: { 200: PublishedSchema, 409: MergeRequiredSchema },
        },
      },
      async (request, reply) => {
        const documentId = await resolveDocumentId(deps, request.params.id)
        const session = requireAuthenticatedSession(request)
        await requireDocumentAccess(authorizerFor(deps, request), documentId, 'edit')
        const result = await publishDocument(deps, {
          documentId,
          base: readBase(request.body.base),
          author: await author(request),
          sessionId: session.sessionId,
          ...(request.body.changeNote === undefined ? {} : { changeNote: request.body.changeNote }),
        })

        switch (result.kind) {
          case 'published':
            return {
              kind: 'published' as const,
              revision: result.revision,
              warnings: [...result.warnings],
              frontMatterIssues: [...result.frontMatterIssues],
              incompleteRequiredSections: [...result.incompleteRequiredSections],
            }
          case 'merge-required':
            return reply.code(409).send({
              kind: 'merge-required' as const,
              current: result.current,
              conflicts: [...result.conflicts],
            })
          case 'lock-lost':
            // Somebody took this document over, so this publish is the
            // previous holder's write and is rejected (ADR-021).
            throw lockLost(result.holder)
          case 'stale-base':
            // The body of a 409 on this route is the merge payload and
            // nothing else, so a base that does not match the draft's own —
            // a caller working from a view it has not refreshed — answers
            // with its own status and its own code.
            throw unprocessable(
              'stale_base',
              'This draft has moved on since you read it; re-read it and publish again',
              { base: result.base },
            )
          /* v8 ignore next 2 -- the authorizer has already loaded this document. */
          case 'not-found':
            throw notFound('Document not found')
          case 'no-draft':
            throw notFound('This document has no draft to publish')
          case 'draft-unreadable':
            throw unprocessable(
              'draft_unreadable',
              'This draft was written by a newer version of the platform',
            )
        }
      },
    )

    app.post(
      '/api/documents/:id/restore',
      {
        preHandler: app.requireVerifiedSession,
        schema: {
          params: IdParamsSchema,
          body: RestoreBodySchema,
          response: { 200: PublishedSchema, 409: MergeRequiredSchema },
        },
      },
      async (request, reply) => {
        const documentId = await resolveDocumentId(deps, request.params.id)
        const session = requireAuthenticatedSession(request)
        await requireDocumentAccess(authorizerFor(deps, request), documentId, 'edit')
        const result = await restoreRevision(deps, {
          documentId,
          revision: revisionId(request.body.revision),
          author: await author(request),
          sessionId: session.sessionId,
          ...(request.body.changeNote === undefined ? {} : { changeNote: request.body.changeNote }),
        })

        if (result.kind === 'published') {
          return {
            kind: 'published' as const,
            revision: result.revision,
            warnings: [...result.warnings],
            frontMatterIssues: [...result.frontMatterIssues],
            incompleteRequiredSections: [...result.incompleteRequiredSections],
          }
        }
        if (result.kind === 'merge-required') {
          // Somebody published between the revision being read and this
          // restore being written, and the two cannot be merged cleanly.
          return reply.code(409).send({
            kind: 'merge-required' as const,
            current: result.current,
            conflicts: [...result.conflicts],
          })
        }
        if (result.kind === 'lock-lost') throw lockLost(result.holder)
        /* v8 ignore next -- the authorizer has already loaded this document. */
        if (result.kind === 'not-found') throw notFound('Document not found')
        throw notFound('That revision does not exist for this document')
      },
    )

    app.get(
      '/api/documents/:id/history',
      {
        preHandler: app.requireSession,
        schema: {
          params: IdParamsSchema,
          querystring: HistoryQuerySchema,
          response: { 200: HistorySchema },
        },
      },
      async (request) => {
        const documentId = await resolveDocumentId(deps, request.params.id)
        await requireDocumentAccess(authorizerFor(deps, request), documentId, 'view')
        return historyResponse(
          await getHistory(deps, {
            documentId,
            limit: request.query.limit,
            cursor: request.query.cursor,
          }),
        )
      },
    )

    app.get(
      '/api/documents/:id/diff',
      {
        preHandler: app.requireSession,
        schema: {
          params: IdParamsSchema,
          querystring: DiffQuerySchema,
          response: { 200: DiffSchema },
        },
      },
      async (request) => {
        const documentId = await resolveDocumentId(deps, request.params.id)
        await requireDocumentAccess(authorizerFor(deps, request), documentId, 'view')
        const result = await getDiff(deps, {
          documentId,
          from: readBase(request.query.from),
          to: revisionId(request.query.to),
        })
        if (result.kind === 'revision-not-found') {
          throw notFound('That revision does not exist for this document')
        }
        /* v8 ignore next -- the authorizer has already loaded this document. */
        if (result.kind !== 'diff') throw notFound('Document not found')
        return {
          from: result.diff.from,
          to: result.diff.to,
          unified: result.diff.unified,
          added: result.diff.added,
          removed: result.diff.removed,
        }
      },
    )

    /**
     * Renaming a document, and moving it.
     *
     * `manage` is required at the source *and* at every destination the patch
     * names, because a move is two decisions: may this person take the
     * document out of where it is, and may they put it where they are asking
     * (review finding H5). The destination itself is validated by the use
     * case — the collection has to be in this workspace, the parent has to be
     * in the destination collection, and nothing may become its own ancestor.
     *
     * A `title` is a write to the document, not only to its row: the title
     * lives in the draft's front matter and first heading, and the row is an
     * index of it (ADR-034), so the rename goes into the draft and the next
     * publish carries it. Like every other write it re-validates the lock, so
     * it answers `423 lock_lost` while somebody else is editing (ADR-021).
     */
    app.patch(
      '/api/documents/:id',
      {
        preHandler: app.requireVerifiedSession,
        schema: {
          params: IdParamsSchema,
          body: UpdateDocumentBody,
          response: { 200: DocumentSchema },
        },
      },
      async (request) => {
        const documentId = await resolveDocumentId(deps, request.params.id)
        const patch = request.body
        const session = requireAuthenticatedSession(request)
        const authorizer = authorizerFor(deps, request)
        await requireDocumentAccess(authorizer, documentId, 'manage')
        if (patch.collectionId !== undefined) {
          await requireCollectionAccess(authorizer, patch.collectionId, 'manage')
        }
        if (typeof patch.parentId === 'string' && patch.parentId.length > 0) {
          await requireDocumentAccess(authorizer, patch.parentId as DocumentId, 'manage')
        }

        const result = await updateDocument(deps, {
          documentId,
          sessionId: session.sessionId,
          patch: {
            ...(patch.title === undefined ? {} : { title: patch.title }),
            ...(patch.slug === undefined ? {} : { slug: patch.slug }),
            ...(patch.path === undefined ? {} : { path: patch.path }),
            ...(patch.status === undefined ? {} : { status: patch.status as DocumentStatus }),
            ...(patch.collectionId === undefined
              ? {}
              : { collectionId: patch.collectionId as CollectionId }),
            ...(patch.parentId === undefined ? {} : { parentId: readParent(patch.parentId) }),
          },
        })

        switch (result.kind) {
          case 'updated':
            return documentResponse(result.document)
          /* v8 ignore next 2 -- the authorizer has already loaded this document. */
          case 'not-found':
            throw notFound('Document not found')
          case 'collection-not-found':
            throw notFound('That collection does not exist in this workspace')
          case 'parent-not-found':
            throw notFound('That parent document does not exist in this workspace')
          case 'parent-outside-collection':
            throw conflict(
              'parent_outside_collection',
              'A document and its parent have to be in the same collection',
            )
          case 'cycle':
            throw conflict(
              'parent_cycle',
              'A document cannot be nested inside itself or one of its own children',
            )
          case 'lock-lost':
            // A rename writes the new title into the draft, so somebody else
            // holding the document refuses it exactly as it refuses a draft
            // write or a publish (ADR-021).
            throw lockLost(result.holder)
        }
      },
    )

    app.delete(
      '/api/documents/:id',
      { preHandler: app.requireVerifiedSession, schema: { params: IdParamsSchema } },
      async (request, reply) => {
        const documentId = await resolveDocumentId(deps, request.params.id)
        const session = requireAuthenticatedSession(request)
        await requireDocumentAccess(authorizerFor(deps, request), documentId, 'manage')
        const result = await deleteDocument(deps, { documentId, deletedBy: session.userId })
        /* v8 ignore next 2 -- the authorizer has already loaded this document. */
        if (result.kind === 'not-found') throw notFound('Document not found')
        reply.status(204)
      },
    )
  }
}

/**
 * A revision from the request, or null.
 *
 * Ajv coerces a JSON `null` to an empty string for a `string | null` field
 * before the null branch is tried, so "no base" arrives either way and is read
 * the same way here.
 */
function readBase(value: string | null | undefined): RevisionId | null {
  return typeof value === 'string' && value.length > 0 ? revisionId(value) : null
}

/**
 * A parent from the request, or null.
 *
 * Ajv coerces a JSON `null` to an empty string before the null branch is
 * tried, exactly as it does for `base`, so "no parent" — which lifts a
 * document to the root of its collection — arrives either way.
 */
function readParent(value: string | null): DocumentId | null {
  return typeof value === 'string' && value.length > 0 ? (value as DocumentId) : null
}
