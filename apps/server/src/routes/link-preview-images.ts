import { Readable } from 'node:stream'

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'

import type { AppDependencies } from '../dependencies.ts'
import { notFound } from '../errors.ts'
import { sniffImageType } from '../infrastructure/link-preview/image-sniff.ts'
import { addressRateLimit } from '../plugins/rate-limit.ts'

/**
 * The pictures link previews show (ADR-042, "Images are ours or nothing"),
 * served from our own origin.
 *
 * A thumbnail or an icon was fetched once, re-encoded to WebP and stored under
 * the hash of its bytes (`image-ingestor.ts`). This is how a reader gets it,
 * which is why no page ever links to the site the picture came from.
 *
 * **Only a hash a preview put there is served.** The blob store holds
 * everything by hash, attachments included, and a hash is not a permission. So
 * a request is answered only if some stored preview shows that exact hash
 * (`isImageReferenced`); for any other hash the answer is the same not-found as
 * for one that does not exist, so the route cannot be used to ask what the
 * store holds. As a second check the bytes must still be a WebP.
 *
 * The response is built to be as inert as a response can be: its type is fixed
 * and `nosniff`, it carries a policy that allows nothing (`default-src 'none'`,
 * `sandbox`) in case it is ever opened on its own, and it is immutable, since
 * the hash is the content. It needs no session, because the public site shows
 * these to anyone.
 */

const HASH = /^[0-9a-f]{64}$/u
const BUCKET = 'link-preview-images'

const Params = Type.Object({ hash: Type.String({ pattern: HASH.source }) })

export function linkPreviewImageRoutes(deps: AppDependencies): FastifyPluginAsync {
  const budget = addressRateLimit(BUCKET, deps.config.publicSiteRateLimitMax)

  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    app.get(
      '/link-previews/images/:hash',
      { config: budget, schema: { params: Params, hide: true } },
      async (request, reply) => {
        const { hash } = request.params
        if (!(await deps.uow.repos.linkPreviews.isImageReferenced(hash))) {
          throw notFound('No such image')
        }

        // The hash is the content, so a reader who has it already has the right bytes.
        const tag = `"${hash}"`
        reply.header('etag', tag)
        reply.header('cache-control', 'public, max-age=31536000, immutable')
        if (request.headers['if-none-match'] === tag) return reply.status(304).send()

        const chunks = await deps.blobStore.open(hash)
        if (chunks === null) throw notFound('No such image')
        const iterator = chunks[Symbol.asyncIterator]()
        const first = await iterator.next()
        if (first.done === true || sniffImageType(first.value) !== 'image/webp') {
          await iterator.return?.()
          throw notFound('No such image')
        }

        reply.type('image/webp')
        reply.header('x-content-type-options', 'nosniff')
        reply.header('content-security-policy', "default-src 'none'; sandbox")
        reply.header('content-disposition', 'inline')
        // The first chunk is already in hand; the rest is piped, never buffered whole.
        return reply.send(
          Readable.from(
            (async function* () {
              yield first.value
              for (
                let next = await iterator.next();
                next.done !== true;
                next = await iterator.next()
              ) {
                yield next.value
              }
            })(),
          ),
        )
      },
    )
  }
}
