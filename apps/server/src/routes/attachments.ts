import { Readable } from 'node:stream'

import fastifyMultipart from '@fastify/multipart'
import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  ALLOWED_MEDIA_TYPES,
  ATTACHMENT_URL_PREFIX,
  deleteAttachment,
  getAttachment,
  listAttachments,
  uploadAttachment,
} from '@quill/application'
import type {
  AttachmentRow,
  Authorizer,
  ImageMediaType,
  ServedAttachment,
} from '@quill/application'
import type { DocumentId } from '@quill/domain'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'

import { authorizerFor, requireDocumentAccess } from '../application/authorization.ts'
import { resolveDocumentId } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'
import {
  conflict,
  notFound,
  notModified,
  payloadTooLarge,
  rateLimited,
  unprocessable,
} from '../errors.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'
import { contentDisposition } from './content-disposition.ts'
import { IdParamsSchema } from './document-schemas.ts'

/**
 * Attachments (ADR-011 uploads, ADR-034, plan §11).
 *
 * Three routes and one rule: an attachment belongs to its document, so every
 * decision about it is a decision about that document. Uploading needs `edit`,
 * reading needs `view`, removing needs `edit`; a share link or the public
 * principal will reach the read route through the same resolver when they
 * arrive in M3 (ADR-012), with nothing here to change.
 *
 * The read route is deliberately plain: a `GET` with a session cookie and
 * nothing else, because that is all a browser sends for `<img src="/api/…">`
 * on the app's own origin. No custom header, no preflight, no fetch wrapper —
 * so the CSP can stay `img-src 'self'` and a picture in a document is just a
 * picture (`plugins/security-headers.ts`).
 */

export const AttachmentSchema = Type.Object(
  {
    id: Type.String(),
    documentId: Type.String(),
    /** Where the document's Markdown points at it: a relative, same-origin URL. */
    url: Type.String(),
    filename: Type.String(),
    /** Sniffed from the bytes, never the uploader's claim (ADR-011). */
    contentType: Type.String({ enum: [...ALLOWED_MEDIA_TYPES] }),
    size: Type.Integer(),
    sha256: Type.String(),
    uploadedBy: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'Attachment' },
)

/**
 * One file, in a multipart field called `file`.
 *
 * `format: 'binary'` is OpenAPI's way of saying "raw bytes", which is what
 * turns this into a file field in the generated client and in the Swagger UI.
 */
export const UploadBodySchema = Type.Object(
  { file: Type.Unsafe<Blob>({ type: 'string', format: 'binary' }) },
  { additionalProperties: false },
)

export const AttachmentListSchema = Type.Object(
  { attachments: Type.Array(Type.Ref(AttachmentSchema)) },
  { $id: 'AttachmentList' },
)

export interface AttachmentResponse {
  readonly id: string
  readonly documentId: string
  readonly url: string
  readonly filename: string
  readonly contentType: string
  readonly size: number
  readonly sha256: string
  readonly uploadedBy: string | null
  readonly createdAt: string
}

export function attachmentResponse(row: AttachmentRow): AttachmentResponse {
  return {
    id: row.id,
    documentId: row.documentId,
    url: `${ATTACHMENT_URL_PREFIX}${row.id}`,
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    sha256: row.sha256,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
  }
}

/** The field an upload's file has to arrive in. */
export const UPLOAD_FIELD = 'file'

/**
 * How long a reader may keep an attachment before asking about it again.
 *
 * Not immutable, and not a year, though the bytes behind an id never change:
 * the *permission* to see them does. An attachment is served under a session,
 * and a grant withdrawn this afternoon has to take effect this afternoon — so
 * the body is revalidated, and the revalidation is cheap because the `ETag` is
 * the hash and a match answers `304` with no body. Five minutes is the window
 * in which a withdrawn reader can still see a cached picture, which is the
 * same window every other private, cached thing here has.
 */
const CACHE_SECONDS = 300

const MEGABYTE = 1024 * 1024

export function attachmentRoutes(deps: AppDependencies): FastifyPluginAsync {
  const { maxBytes, rateLimit } = deps.config.attachments

  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    // Registered inside this plugin, so the multipart content-type parser is
    // this route's and no other route's. One byte over the cap is allowed
    // through on purpose: the use case is what refuses, with a result that
    // names the cap, and it has to see the byte that crossed it. The parser's
    // own limit is still what bounds an endless upload.
    await app.register(fastifyMultipart, {
      limits: { fileSize: maxBytes + 1, files: 1, fields: 4 },
      throwFileSizeLimit: false,
    })

    app.addSchema(AttachmentSchema)
    app.addSchema(AttachmentListSchema)

    /** The row, checked against the document that owns it — which is what governs it. */
    async function authorisedAttachment(
      request: FastifyRequest<{ Params: { id: string } }>,
      capability: 'view' | 'edit',
    ): Promise<AttachmentRow> {
      const row = await deps.uow.repos.attachments.findById(request.params.id)
      // A soft-deleted attachment is gone, and says so with the same answer an
      // id that never existed gets: "deleted" must not be a way to learn that
      // something was once here.
      if (row === null || row.deletedAt !== null) {
        throw notFound('That attachment does not exist')
      }
      await requireDocumentAccess(authorizerFor(deps, request), row.documentId, capability)
      return row
    }

    app.post(
      '/api/documents/:id/attachments',
      {
        preHandler: app.requireVerifiedSession,
        schema: {
          params: IdParamsSchema,
          consumes: ['multipart/form-data'],
          // Declared so the OpenAPI description — and the client generated
          // from it (ADR-025) — say what this route takes. It is a
          // description, not a gate: the body is a stream this handler
          // consumes itself, so there is nothing for a validator to be handed.
          body: UploadBodySchema,
          response: { 201: Type.Ref(AttachmentSchema) },
        },
        /*
         * Validation off for this route, which costs nothing it had.
         * `IdParamsSchema` is one path segment typed as a string, and a path
         * segment is always a present string, so no request this route can
         * receive could fail it; the body is the multipart stream, which
         * cannot be validated before it is read. Every check that matters —
         * the size, the sniff, the declared type — is in the use case, where
         * it can see the bytes.
         */
        validatorCompiler: () => (data) => ({ value: data }),
      },
      async (request, reply) => {
        const documentId = await resolveDocumentId(deps, request.params.id)
        const session = requireAuthenticatedSession(request)
        await requireDocumentAccess(authorizerFor(deps, request), documentId, 'edit')

        // Asked before the file is read and spent only once one is stored, so
        // a refusal — which costs a few hundred bytes and no storage — leaves
        // an honest person's budget where it was (ADR-011 abuse resistance).
        const budget = uploadBudget(session.userId)
        const standing = deps.attachmentRateLimiter.peek(budget)
        if (standing.current >= rateLimit.max) {
          // The same audit hook every other limit reports through, so a
          // spending spree looks the same in the log wherever it happened.
          app.onRateLimitExceeded(request, budget)
          throw rateLimited(standing.ttl)
        }

        const part = await request.file()
        if (part === undefined) {
          throw unprocessable(
            'file_missing',
            `Send the file in a multipart field called "${UPLOAD_FIELD}"`,
          )
        }
        if (part.fieldname !== UPLOAD_FIELD) {
          // Drained before answering: busboy holds the request until its
          // stream is consumed, and the parser's own limit bounds it.
          part.file.resume()
          throw unprocessable(
            'file_missing',
            `Send the file in a multipart field called "${UPLOAD_FIELD}", not "${part.fieldname}"`,
          )
        }

        const result = await uploadAttachment(deps, {
          documentId,
          uploadedBy: session.userId,
          filename: part.filename,
          declaredContentType: part.mimetype,
          body: part.file,
          maxBytes,
        })

        if (result.kind !== 'uploaded') part.file.resume()

        switch (result.kind) {
          case 'uploaded':
            deps.attachmentRateLimiter.hit(budget)
            reply.status(201)
            return attachmentResponse(result.attachment)
          /* v8 ignore next 2 -- the authorizer has already loaded this document. */
          case 'document-not-found':
            throw notFound('Document not found')
          case 'empty':
            throw unprocessable('file_empty', 'That file has nothing in it')
          case 'too-large':
            throw payloadTooLarge(
              `That file is larger than the ${Math.floor(result.maxBytes / MEGABYTE)} MB limit`,
              { maxBytes: result.maxBytes },
            )
          case 'type-not-allowed':
            throw unprocessable('file_type_not_allowed', refusalFor(result.sniffed), {
              sniffed: result.sniffed,
              allowed: [...ALLOWED_MEDIA_TYPES],
            })
          case 'type-mismatch':
            throw unprocessable(
              'file_type_mismatch',
              `That file was sent as ${result.declared}, but its contents are ${result.sniffed}`,
              { declared: result.declared, sniffed: result.sniffed },
            )
          case 'malformed':
            throw unprocessable(
              'file_malformed',
              `That file could not be read as ${describeImage(result.contentType)}: ${result.reason}. Export it again and upload that.`,
              { contentType: result.contentType, reason: result.reason },
            )
        }
      },
    )

    app.get(
      '/api/documents/:id/attachments',
      {
        preHandler: app.requireSession,
        schema: { params: IdParamsSchema, response: { 200: Type.Ref(AttachmentListSchema) } },
      },
      async (request) => {
        const documentId = await resolveDocumentId(deps, request.params.id)
        await requireDocumentAccess(authorizerFor(deps, request), documentId, 'view')
        const rows = await listAttachments(deps, documentId)
        return { attachments: rows.map(attachmentResponse) }
      },
    )

    app.get(
      '/api/attachments/:id',
      {
        preHandler: app.requireSession,
        // No response schema: the body is bytes, and declaring one would put
        // the JSON serialiser in front of them. What a caller needs to know is
        // the headers, which `docs/architecture/api-contract-m2.md` states.
        schema: { params: IdParamsSchema },
      },
      async (request, reply) => {
        const row = await authorisedAttachment(request, 'view')

        // The tag is the hash, so it is known before the object is opened —
        // and the conditional is answered *after* the authorizer has run, so
        // a reader whose access was withdrawn gets the refusal rather than a
        // cheap `304` telling them their copy is still good.
        const etag = `"${row.sha256}"`
        reply.header('etag', etag)
        reply.header('cache-control', `private, max-age=${CACHE_SECONDS}, must-revalidate`)
        if (request.headers['if-none-match'] === etag) throw notModified()

        const served = await getAttachment(deps, { attachmentId: row.id })
        // A row whose object has gone is a miss to the reader: the file is not
        // there, which is what a 404 says, and claiming a server fault would
        // send them looking in the wrong place.
        if (served.kind !== 'found') throw notFound('That attachment does not exist')
        return serve(reply, served)
      },
    )

    app.delete(
      '/api/attachments/:id',
      { preHandler: app.requireVerifiedSession, schema: { params: IdParamsSchema } },
      async (request, reply) => {
        const session = requireAuthenticatedSession(request)
        const row = await authorisedAttachment(request, 'edit')

        const result = await deleteAttachment(deps, {
          attachmentId: row.id,
          deletedBy: session.userId,
        })
        switch (result.kind) {
          case 'deleted':
            reply.status(204)
            return
          /* v8 ignore next 2 -- the row was loaded and checked a moment ago. */
          case 'not-found':
            throw notFound('That attachment does not exist')
          case 'in-use':
            throw conflict(
              'attachment_in_use',
              'A published document still shows this file. Take it out of the document, publish, and then delete it.',
              await visibleDocuments(authorizerFor(deps, request), result.documents),
            )
        }
      },
    )
  }
}

/** The bucket one person's uploads count against, whichever document they aim at. */
export function uploadBudget(userId: string): string {
  return `attachment:upload:account:${userId}`
}

/**
 * The refusal's detail: the documents the caller may actually see, and a count
 * of the ones they may not.
 *
 * Naming a document somebody cannot open would tell them it exists, which is
 * exactly what a workspace they have no grant on is meant not to do — and the
 * count is not nothing either, because "this is held by two documents you
 * cannot see" is what turns a baffling refusal into one an administrator can
 * act on (ADR-012).
 */
async function visibleDocuments(
  authorizer: Authorizer,
  documents: readonly DocumentId[],
): Promise<{ documents: string[]; hidden: number }> {
  const visible: string[] = []
  let hidden = 0
  for (const documentId of documents) {
    const access = await authorizer.document(documentId)
    if (access.ok && access.value.capabilities.view) visible.push(documentId)
    else hidden += 1
  }
  return { documents: visible, hidden }
}

/** The format's everyday name, for a refusal that has to say what it tried to read. */
const IMAGE_NAMES: Readonly<Record<ImageMediaType, string>> = {
  'image/png': 'a PNG image',
  'image/jpeg': 'a JPEG image',
  'image/gif': 'a GIF image',
  'image/webp': 'a WebP image',
  'image/avif': 'an AVIF image',
}

function describeImage(contentType: ImageMediaType): string {
  return IMAGE_NAMES[contentType]
}

/** Why this file was refused, in the words the person who chose it would use. */
function refusalFor(sniffed: string | null): string {
  if (sniffed === 'image/svg+xml') {
    return 'SVG files are not accepted: an SVG is a document that can carry scripts, so the platform neither stores nor renders one. Export the drawing as PNG and upload that.'
  }
  return 'That file is not a type this platform accepts. Images (PNG, JPEG, GIF, WebP and AVIF) and PDFs are.'
}

/**
 * The headers an attachment is served with (ADR-011 "safe serving").
 *
 * `nosniff` is the one that matters most: it is what stops a browser deciding
 * for itself that a file the server called `image/png` is really HTML, which
 * is how an upload becomes stored cross-site scripting. `Content-Disposition`
 * carries the intent — a picture is shown, a PDF is saved — with the name in
 * both of RFC 6266's forms, so a name in any script survives the crossing
 * (`content-disposition.ts`).
 */
function serve(reply: FastifyReply, served: ServedAttachment): Readable {
  const { attachment } = served
  reply.header('content-type', attachment.contentType)
  reply.header('content-length', String(attachment.size))
  reply.header('content-disposition', contentDisposition(served.disposition, attachment.filename))
  reply.header('x-content-type-options', 'nosniff')
  // Nothing in an attachment is meant to run, whatever a browser decides it
  // is looking at. This is the second belt beside `nosniff`, and it costs a
  // header: a policy of `sandbox` with no origin at all.
  reply.header(
    'content-security-policy',
    "default-src 'none'; img-src 'self' data:; object-src 'none'; sandbox",
  )
  // One shape for both adapters: the filesystem store hands back a read
  // stream and the S3 store an async generator, and Fastify sends a stream.
  return Readable.from(served.body)
}
