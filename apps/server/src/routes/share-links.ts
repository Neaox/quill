import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  createShareLink,
  findShareLink,
  listShareLinks,
  recordShareLinkUse,
  renderDocument,
  resolveDocumentReference,
  revokeShareLink,
  shareLinkNavigation,
} from '@quill/application'
import type { DocumentRow, ShareLinkRow } from '@quill/application'
import { isUuid, ROLES, SHARE_LINK_ROLES, SHARE_LINK_SCOPES, slugify } from '@quill/domain'
import type { DocumentId, Role, ShareLinkId, ShareLinkRole, ShareLinkScope } from '@quill/domain'
import type { FastifyPluginAsync, FastifyReply } from 'fastify'

import {
  authorizerFor,
  requireDocumentAccess,
  requireSharedDocument,
  SHARE_REFUSAL,
} from '../application/authorization.ts'
import { resolveDocumentId } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'
import { AppError, notFound, notModified, unprocessable } from '../errors.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'
import { addressRateLimit } from '../plugins/rate-limit.ts'
import { IdParamsSchema, RenderedSchema } from './document-schemas.ts'

/**
 * Share links (plan section 14; ADR-011; ADR-012).
 *
 * Two halves that barely speak to each other. The **managing** half sits
 * inside the application like every other route: a session, `manage` on the
 * document, and the ordinary error shape. The **reading** half is the only
 * unauthenticated, non-public surface the platform has, and everything about
 * it is shaped by what `docs/product/surfaces.md` says must never appear on a
 * share-link page:
 *
 * - **The token is the credential**, carried in the path because that is what
 *   makes a link a link. It never reaches a log — `plugins/logging.ts`
 *   redacts it from every request line — and never reaches an audit row,
 *   which names the link's id instead.
 * - **Every refusal is the same `404`.** An unknown token, an expired one, a
 *   revoked one, a document outside the link's scope, an unpublished
 *   document, and a document that does not exist are indistinguishable.
 * - **No drafts, no lock, no workspace.** The response carries the published
 *   body, the document's own name, and — for a subtree link — the published
 *   documents under it. Nothing else about the organisation travels.
 * - **Rate limited per address**, because the surface is anonymous and its
 *   security rests entirely on a token nobody can guess (ADR-011).
 * - **`noindex`**, on every response.
 *
 * A signed-in member who opens a share link gets the share-link page, not the
 * application: the session cookie is not read on these routes at all, so the
 * link looks the same to everyone who holds it — the same rule the public
 * site follows (`surfaces.md`).
 */

/** One bucket for the whole anonymous reading surface, keyed by source address. */
export const SHARE_READ_BUCKET = 'share:read'

const ShareLinkScopeSchema = Type.Unsafe<ShareLinkScope>({
  type: 'string',
  enum: [...SHARE_LINK_SCOPES],
})

/**
 * What a *stored* link carries: view only in the first release; comment and
 * edit arrive in M7 (plan section 14).
 */
const ShareLinkRoleSchema = Type.Unsafe<ShareLinkRole>({
  type: 'string',
  enum: [...SHARE_LINK_ROLES],
})

/**
 * What a request may *ask* for: any of the platform's roles.
 *
 * Wider than what is stored on purpose. A schema rejection says only that a
 * value was not in a list; `422 share_link_role_unavailable` says which role
 * was asked for and that this release does not carry it, which is what the
 * share dialog shows — and when M7 widens the answer, it widens in the use
 * case rather than in the wire format.
 */
const RequestedRoleSchema = Type.Unsafe<Role>({ type: 'string', enum: [...ROLES] })

const NullableDateTime = Type.Union([Type.String({ format: 'date-time' }), Type.Null()])

export const ShareLinkSchema = Type.Object(
  {
    id: Type.String(),
    documentId: Type.String(),
    scope: ShareLinkScopeSchema,
    role: ShareLinkRoleSchema,
    expiresAt: NullableDateTime,
    createdBy: Type.String(),
    createdAt: Type.String({ format: 'date-time' }),
    revokedAt: NullableDateTime,
    /** When the link was last followed, so the list answers "is anyone using this?" */
    lastUsedAt: NullableDateTime,
  },
  { $id: 'ShareLink' },
)

export const ShareLinkListSchema = Type.Object({ links: Type.Array(Type.Ref(ShareLinkSchema)) })

export const CreateShareLinkBodySchema = Type.Object({
  scope: ShareLinkScopeSchema,
  role: Type.Optional(RequestedRoleSchema),
  /** Omitted for a link that never expires; a JSON `null` means the same. */
  expiresAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
})

export const CreatedShareLinkSchema = Type.Object({
  link: Type.Ref(ShareLinkSchema),
  /**
   * The raw token, returned exactly once. Only its SHA-256 is stored, so no
   * later request — by anyone, holding any permission — can produce it again.
   */
  token: Type.String(),
  /** The address to send someone, built from `APP_URL`. */
  url: Type.String(),
})

/** A document a share-link reader may move to, and the ones below it. */
export const SharedNodeSchema = Type.Recursive(
  (Self) =>
    Type.Object({
      id: Type.String(),
      shortId: Type.String(),
      title: Type.String(),
      slug: Type.String(),
      children: Type.Array(Self),
    }),
  { $id: 'SharedNode' },
)

const SharedDocumentFields = {
  id: Type.String(),
  shortId: Type.String(),
  title: Type.String(),
  /** Derived from the current title, exactly as `Document.slug` is (ADR-035). */
  slug: Type.String(),
  updatedAt: Type.String({ format: 'date-time' }),
}

export const SharedBodySchema = Type.Object({
  document: Type.Object(SharedDocumentFields),
  rendered: RenderedSchema,
})

export const SharedDocumentSchema = Type.Object({
  link: Type.Object({
    scope: ShareLinkScopeSchema,
    role: ShareLinkRoleSchema,
    expiresAt: NullableDateTime,
  }),
  document: Type.Object(SharedDocumentFields),
  rendered: RenderedSchema,
  /** Empty for a document-scoped link: the page offers no way out of its scope. */
  children: Type.Array(Type.Ref(SharedNodeSchema)),
})

/**
 * The two named schemas this file adds, registered so the OpenAPI description
 * carries one definition each and a generator can follow the self-reference
 * (see `document-schemas.ts`).
 */
export const SHARE_SCHEMAS = [ShareLinkSchema, SharedNodeSchema]

const TOKEN_MAX_LENGTH = 200

const TokenParamsSchema = Type.Object({
  token: Type.String({ minLength: 1, maxLength: TOKEN_MAX_LENGTH }),
})

const TokenDocumentParamsSchema = Type.Object({
  token: Type.String({ minLength: 1, maxLength: TOKEN_MAX_LENGTH }),
  id: Type.String(),
})

export function shareLinkResponse(row: ShareLinkRow): Static<typeof ShareLinkSchema> {
  return {
    id: row.id,
    documentId: row.documentId,
    scope: row.scope,
    role: row.role as ShareLinkRole,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }
}

/** What a reader is told about the document itself: its name, and when it moved. */
function sharedDocument(row: DocumentRow): Static<typeof SharedBodySchema>['document'] {
  return {
    id: row.id,
    shortId: row.shortId,
    title: row.title,
    slug: slugify(row.title),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** The address to send somebody. The token is the whole of the capability. */
export function shareLinkUrl(appUrl: string, token: string): string {
  return `${appUrl}/share/${token}`
}

/**
 * An expiry from the request.
 *
 * Ajv coerces a JSON `null` to an empty string for a `string | null` field
 * before the null branch is tried, so "never expires" arrives as `undefined`,
 * as `null`, or as `''`, and all three mean the same thing here.
 */
function readExpiry(value: string | null | undefined): Date | null {
  return typeof value === 'string' && value.length > 0 ? new Date(value) : null
}

/**
 * A share-link page belongs in no index and in no sitemap
 * (`docs/product/surfaces.md`). The header goes on the API response the page
 * is built from as well as on the page, because the API response is itself a
 * URL somebody can be handed.
 */
function noIndex(reply: FastifyReply): void {
  reply.header('x-robots-tag', 'noindex, nofollow')
}

export function shareLinkRoutes(deps: AppDependencies): FastifyPluginAsync {
  /**
   * A document reference from a share URL: its UUID or its short key
   * (ADR-035), or null.
   *
   * `resolveDocumentId` would do the same job, but it answers a reference
   * that names nothing with its own `404`, and on this surface every refusal
   * has to read identically — so the miss comes back as a value here and the
   * caller raises the one refusal this file ever raises.
   */
  const sharedDocumentId = async (reference: string): Promise<DocumentId | null> => {
    if (isUuid(reference)) return reference.toLowerCase() as DocumentId
    const resolved = await resolveDocumentReference(deps, { reference })
    return resolved.kind === 'resolved' ? resolved.document.id : null
  }

  /**
   * The published body of a document on the share surface, or a `404`.
   *
   * A document with no published revision has nothing to show here — drafts
   * never appear on a share-link page — and saying so would confirm that the
   * document exists, so it is refused exactly like everything else.
   */
  // The shape is checked against `SharedBodySchema` where it is returned, by
  // the route's own response schema, rather than annotated here: the type
  // provider's view of a `$ref` and TypeBox's `Static` of one are not the
  // same type, and the schema is the contract either way.
  const publishedBody = async (document: DocumentRow) => {
    const rendered = await renderDocument(deps, { documentId: document.id })
    if (rendered.kind !== 'rendered') throw notFound(SHARE_REFUSAL)
    return {
      // The render-cache key is the whole of the body's identity: what it was
      // rendered from, and the render version (ADR-031).
      etag: `"${rendered.key}"`,
      body: {
        document: sharedDocument(document),
        rendered: {
          revision: rendered.revision,
          html: rendered.content.html,
          outline: [...rendered.content.outline],
          slots: [...rendered.content.slots],
        },
      },
    }
  }

  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    app.post(
      '/api/documents/:id/share-links',
      {
        preHandler: app.requireVerifiedSession,
        schema: {
          params: IdParamsSchema,
          body: CreateShareLinkBodySchema,
          response: { 201: CreatedShareLinkSchema },
        },
      },
      async (request, reply) => {
        const documentId = await resolveDocumentId(deps, request.params.id)
        const session = requireAuthenticatedSession(request)
        await requireDocumentAccess(authorizerFor(deps, request), documentId, 'manage')

        const result = await createShareLink(deps, {
          documentId,
          scope: request.body.scope as ShareLinkScope,
          role: (request.body.role ?? 'viewer') as Role,
          expiresAt: readExpiry(request.body.expiresAt),
          createdBy: session.userId,
        })

        switch (result.kind) {
          case 'created':
            return reply.code(201).send({
              link: shareLinkResponse(result.link),
              token: result.token,
              url: shareLinkUrl(deps.config.appUrl, result.token),
            })
          case 'not-allowed':
            // Its own code, not a plain `forbidden`: this is a statement
            // about the organisation rather than about the person, and the
            // share dialog says so rather than offering a control that fails.
            throw new AppError(
              403,
              'share_links_disabled',
              'This organisation does not allow share links',
            )
          case 'role-unavailable':
            throw unprocessable(
              'share_link_role_unavailable',
              'Share links carry view only in this release',
              { role: result.role },
            )
          case 'expiry-in-the-past':
            throw unprocessable(
              'share_link_expiry_in_the_past',
              'A share link cannot expire in the past',
            )
        }
      },
    )

    app.get(
      '/api/documents/:id/share-links',
      {
        preHandler: app.requireSession,
        schema: { params: IdParamsSchema, response: { 200: ShareLinkListSchema } },
      },
      async (request) => {
        const documentId = await resolveDocumentId(deps, request.params.id)
        await requireDocumentAccess(authorizerFor(deps, request), documentId, 'manage')
        const links = await listShareLinks(deps, { documentId })
        return { links: links.map(shareLinkResponse) }
      },
    )

    app.delete(
      '/api/share-links/:id',
      { preHandler: app.requireVerifiedSession, schema: { params: IdParamsSchema } },
      async (request, reply) => {
        const session = requireAuthenticatedSession(request)
        const shareLinkId = request.params.id as ShareLinkId
        const link = await findShareLink(deps, shareLinkId)
        if (link === null) throw notFound('Share link not found')

        // Managing a link is managing the document it opens: whoever may
        // grant access there may close a door into it.
        await requireDocumentAccess(authorizerFor(deps, request), link.documentId, 'manage')
        await revokeShareLink(deps, { shareLinkId, revokedBy: session.userId })
        reply.status(204)
      },
    )

    app.get(
      '/api/share/:token',
      {
        config: addressRateLimit(SHARE_READ_BUCKET),
        schema: { params: TokenParamsSchema, response: { 200: SharedDocumentSchema } },
      },
      async (request, reply) => {
        noIndex(reply)
        // Resolution happens inside the authorizer, so the link behind the
        // token and the permission it confers are decided once, from one row.
        const authorizer = authorizerFor(deps, request, request.params.token)
        const resolved = await authorizer.shareLink()
        if (resolved === null) throw notFound(SHARE_REFUSAL)

        const access = await requireSharedDocument(authorizer, resolved.document.id)
        const { body } = await publishedBody(access.document)
        await recordShareLinkUse(deps, { link: resolved.link, actorUserId: null })

        return {
          link: {
            scope: resolved.link.scope,
            role: resolved.link.role as ShareLinkRole,
            expiresAt: resolved.link.expiresAt?.toISOString() ?? null,
          },
          ...body,
          children: [...(await shareLinkNavigation(deps, resolved))],
        }
      },
    )

    app.get(
      '/api/share/:token/documents/:id/rendered',
      {
        config: addressRateLimit(SHARE_READ_BUCKET),
        schema: { params: TokenDocumentParamsSchema, response: { 200: SharedBodySchema } },
      },
      async (request, reply) => {
        noIndex(reply)
        const authorizer = authorizerFor(deps, request, request.params.token)
        const resolved = await authorizer.shareLink()
        if (resolved === null) throw notFound(SHARE_REFUSAL)

        // The link's scope is what refuses a document outside its subtree,
        // and it refuses as a `404`: a reader must not learn which ids exist
        // by asking for them (ADR-011).
        const documentId = await sharedDocumentId(request.params.id)
        if (documentId === null) throw notFound(SHARE_REFUSAL)
        const access = await requireSharedDocument(authorizer, documentId)
        const { body, etag } = await publishedBody(access.document)
        await recordShareLinkUse(deps, { link: resolved.link, actorUserId: null })

        reply.header('etag', etag)
        reply.header('cache-control', 'private, no-cache')
        if (request.headers['if-none-match'] === etag) throw notModified()
        return body
      },
    )
  }
}
