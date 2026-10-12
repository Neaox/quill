import fastifyMultipart from '@fastify/multipart'
import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  EMOJI_MEDIA_TYPES,
  EMOJI_URL_PREFIX,
  MAX_EMOJI_BYTES,
  readEmojiImage,
  uploadEmojiImage,
} from '@quill/application'
import type { FastifyPluginAsync } from 'fastify'

import { requireInstanceAdmin } from '../application/authorization.ts'
import type { AppDependencies } from '../dependencies.ts'
import { notFound, payloadTooLarge, unprocessable } from '../errors.ts'
import { addressRateLimit } from '../plugins/rate-limit.ts'
import { FONT_MAX_AGE_SECONDS } from '../theme/face-files.ts'
import { UPLOAD_FIELD, UploadBodySchema } from './attachments.ts'
import { PUBLIC_SITE_BUCKET } from './public-site.ts'

/**
 * The organisation's emoji images (ADR-038).
 *
 * - `POST /api/settings/organisation/emoji-images` stores an image and
 *   answers with its hash, which the settings screen then saves under a name
 *   in the organisation's settings. Instance administration, like every
 *   change to those settings.
 * - `GET /api/emoji/:file` serves an image a saved emoji names, to anybody:
 *   emoji are drawn on the public site and on share links, which have no
 *   session, exactly as the theme's fonts are. The file name carries a hash
 *   of the bytes, so the answer is immutable for a year.
 *
 * **SVG is only ever a picture.** In `<img>` an SVG runs no script and loads
 * nothing. Opened directly, it would be a document on this origin, so every
 * answer carries the attachment route's sandboxing policy: no script, no
 * origin, nothing loaded but its own inline images.
 */

const EmojiImageSchema = Type.Object(
  {
    /** Lower-case hex SHA-256: what the settings file stores as the emoji's `hash`. */
    hash: Type.String({ pattern: '^[0-9a-f]{64}$' }),
    mediaType: Type.Union(EMOJI_MEDIA_TYPES.map((type) => Type.Literal(type))),
    /** An animation's first frame, stored beside it for readers who ask for less motion. */
    still: Type.Optional(Type.String({ pattern: '^[0-9a-f]{64}$' })),
    /** An animation's frame count and the length of one loop, in milliseconds (ADR-047). */
    frames: Type.Optional(Type.Integer({ minimum: 2 })),
    milliseconds: Type.Optional(Type.Integer({ minimum: 1 })),
    /** How many times the stored copy plays, written into the file so it stops without script. */
    plays: Type.Optional(Type.Integer({ minimum: 1 })),
    /** The upload as it came, kept when the stored copy's play count was changed; never served. */
    original: Type.Optional(Type.String({ pattern: '^[0-9a-f]{64}$' })),
  },
  { $id: 'EmojiImage', additionalProperties: false },
)

const FileParams = Type.Object({ file: Type.String({ maxLength: 80 }) })

const KILOBYTE = 1024

export function emojiRoutes(deps: AppDependencies): FastifyPluginAsync {
  const budget = addressRateLimit(PUBLIC_SITE_BUCKET, deps.config.publicSiteRateLimitMax)

  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    // One byte over the cap is let through so the use case sees it and
    // answers with the cap; the parser's limit still bounds the stream.
    await app.register(fastifyMultipart, {
      limits: { fileSize: MAX_EMOJI_BYTES + 1, files: 1, fields: 2 },
      throwFileSizeLimit: false,
    })
    app.addSchema(EmojiImageSchema)

    app.post(
      '/api/settings/organisation/emoji-images',
      {
        preHandler: app.requireVerifiedSession,
        schema: {
          consumes: ['multipart/form-data'],
          body: UploadBodySchema,
          response: { 201: Type.Ref(EmojiImageSchema) },
        },
        // As for attachments: the body is a stream only the handler can read,
        // so every check that matters is the use case's, against the bytes.
        validatorCompiler: () => (data) => ({ value: data }),
      },
      async (request, reply) => {
        await requireInstanceAdmin(deps, request)
        const part = await request.file()
        if (part === undefined || part.fieldname !== UPLOAD_FIELD) {
          part?.file.resume()
          throw unprocessable(
            'file_missing',
            `Send the image in a multipart field called "${UPLOAD_FIELD}"`,
          )
        }
        const result = await uploadEmojiImage(deps, {
          declaredContentType: part.mimetype,
          body: part.file,
        })
        if (result.kind !== 'uploaded') part.file.resume()
        switch (result.kind) {
          case 'uploaded': {
            reply.status(201)
            const { kind: _uploaded, ...image } = result
            return image
          }
          case 'empty':
            throw unprocessable('file_empty', 'That file has nothing in it')
          case 'too-large':
            throw payloadTooLarge(
              `An emoji image may be at most ${result.maxBytes / KILOBYTE} KB`,
              { maxBytes: result.maxBytes },
            )
          case 'type-not-allowed':
            throw unprocessable(
              'file_type_not_allowed',
              'An emoji is a PNG, JPEG, GIF, WebP, AVIF or SVG image.',
              { sniffed: result.sniffed, allowed: [...EMOJI_MEDIA_TYPES] },
            )
          case 'animation-over-limits':
            throw unprocessable(
              'file_animation_too_long',
              `An animated emoji may have at most ${result.maxFrames} frames and run for at most ${result.maxMilliseconds / 1000} seconds; this one has ${result.frames} frames and runs for ${(result.milliseconds / 1000).toFixed(1)} seconds.`,
              {
                frames: result.frames,
                milliseconds: result.milliseconds,
                maxFrames: result.maxFrames,
                maxMilliseconds: result.maxMilliseconds,
              },
            )
          case 'type-mismatch':
            throw unprocessable(
              'file_type_mismatch',
              `That file was sent as ${result.declared}, but its contents are ${result.sniffed}`,
              { declared: result.declared, sniffed: result.sniffed },
            )
          case 'malformed':
            throw unprocessable(
              'file_malformed',
              `That image could not be read: ${result.reason}. Export it again and upload that.`,
              { reason: result.reason },
            )
        }
      },
    )

    app.get(
      `${EMOJI_URL_PREFIX}:file`,
      // Not in the OpenAPI description: an image is linked, not called.
      { config: budget, schema: { params: FileParams, hide: true } },
      async (request, reply) => {
        const served = await readEmojiImage(deps, request.params.file)
        if (served === null) throw notFound('No such emoji')
        reply.type(served.mediaType)
        reply.header('cache-control', `public, max-age=${FONT_MAX_AGE_SECONDS}, immutable`)
        reply.header('x-content-type-options', 'nosniff')
        reply.header(
          'content-security-policy',
          "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
        )
        return Buffer.from(served.bytes)
      },
    )
  }
}
