import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  MAX_LINKS_PER_READ,
  getLinkPreviews,
  readInternalLinkPreviews,
  refreshLinkPreview,
} from '@quill/application'
import {
  LINK_PREVIEW_FAILURES,
  LINK_PREVIEW_KINDS,
  LINK_PREVIEW_LAYERS,
  MAX_URL_LENGTH,
  PREVIEW_TONES,
  internalDocumentAddress,
} from '@quill/domain'
import type {
  LinkPreviewFailure,
  LinkPreviewKind,
  LinkPreviewLayer,
  PreviewTone,
} from '@quill/domain'
import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'

import { authorizerFor } from '../application/authorization.ts'
import { internalLinks, linkPreviewDependencies } from '../application/fill-links.ts'
import type { AppDependencies } from '../dependencies.ts'
import { forbidden, rateLimited, unprocessable } from '../errors.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'
import { strictValidator } from './strict-validator.ts'

/**
 * Link previews for the reading and writing surfaces (ADR-042).
 *
 * Both endpoints only ever read what is stored and queue a fetch. Neither waits
 * on a third-party server, so both answer in the time of one query however
 * slow or hostile the linked site is. A signed-in session is enough: a
 * preview is the same information as the link, and the viewer's organisation's
 * policy decides whether they are shown it.
 *
 * `POST` for the read, though it changes nothing the caller can see, because
 * the list of links a page carries does not fit in a query string, and because
 * asking is what queues the fetch.
 */

/** A string that is one of the domain's own list, so the list is written once and the type follows it. */
const oneOf = <T extends string>(values: readonly T[]) =>
  Type.Unsafe<T>(Type.String({ enum: [...values] }))

const ImageSchema = Type.Object({
  hash: Type.String(),
  width: Type.Integer(),
  height: Type.Integer(),
  mediaType: Type.String(),
})

const PreviewSchema = Type.Object({
  url: Type.String(),
  canonicalUrl: Type.String(),
  title: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  siteName: Type.Union([Type.String(), Type.Null()]),
  kind: oneOf<LinkPreviewKind>(LINK_PREVIEW_KINDS),
  thumbnail: Type.Union([ImageSchema, Type.Null()]),
  favicon: Type.Union([ImageSchema, Type.Null()]),
  layer: oneOf<LinkPreviewLayer>(LINK_PREVIEW_LAYERS),
  fetchedAt: Type.String(),
  status: Type.Optional(
    Type.Object({ label: Type.String(), tone: oneOf<PreviewTone>(PREVIEW_TONES) }),
  ),
  embed: Type.Optional(
    Type.Object({ provider: Type.String(), src: Type.String(), aspectRatio: Type.Number() }),
  ),
  file: Type.Optional(
    Type.Object({
      mediaType: Type.String(),
      bytes: Type.Union([Type.Integer(), Type.Null()]),
      name: Type.Union([Type.String(), Type.Null()]),
    }),
  ),
  code: Type.Optional(
    Type.Object({
      language: Type.Union([Type.String(), Type.Null()]),
      startLine: Type.Integer(),
      // The domain's lines are read-only; the schema's own array type is not, so it is stated.
      lines: Type.Unsafe<readonly string[]>(Type.Array(Type.String())),
      path: Type.String(),
      repository: Type.String(),
    }),
  ),
})

/** What a surface is told about one link: a preview, or the reason there is none. */
const ViewSchema = Type.Union([
  Type.Object({ state: Type.Literal('ready'), preview: PreviewSchema, stale: Type.Boolean() }),
  Type.Object({ state: Type.Literal('pending') }),
  Type.Object({
    state: Type.Literal('unavailable'),
    reason: oneOf<LinkPreviewFailure>(LINK_PREVIEW_FAILURES),
  }),
  Type.Object({ state: Type.Literal('blocked') }),
])

const UrlSchema = Type.String({ minLength: 1, maxLength: MAX_URL_LENGTH })

/** What a link the read gave no answer for is: one that cannot be previewed. */
const UNAVAILABLE = { state: 'unavailable', reason: 'invalid_url' } as const

export function linkPreviewRoutes(deps: AppDependencies): FastifyPluginAsync {
  /** The shared dependencies plus the three ports the composition root chose. */
  const previews = linkPreviewDependencies(deps)
  /** The address of this instance's own pages, so a pasted app URL reads as the document it names. */
  const withoutAppOrigin = (url: string): string =>
    url.startsWith(`${deps.config.appUrl}/`) ? url.slice(deps.config.appUrl.length) : url
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()
    app.setValidatorCompiler(strictValidator())

    app.post(
      '/api/link-previews/resolve',
      {
        preHandler: app.requireSession,
        schema: {
          body: Type.Object(
            { urls: Type.Array(UrlSchema, { minItems: 1, maxItems: MAX_LINKS_PER_READ }) },
            { additionalProperties: false },
          ),
          response: {
            200: Type.Object({
              previews: Type.Array(Type.Object({ url: Type.String(), view: ViewSchema })),
            }),
          },
        },
      },
      async (request) => {
        const { userId } = requireAuthenticatedSession(request)
        // Looking up is cheap, but not free, and polling is a loop a script can run flat out.
        if (!previews.limits.allowRead(userId)) throw rateLimited(1_000)

        // A link to a document of this instance is answered for this reader by id: allowed, it is
        // the document's live title; otherwise `blocked`, the same as one that does not exist.
        const asked = request.body.urls.map((url) => ({
          url,
          address: internalDocumentAddress(withoutAppOrigin(url)),
        }))
        const documentLinks = internalLinks(deps, {
          kind: 'authorized',
          authorizer: authorizerFor(deps, request),
        })
        const keys = asked.flatMap(({ address }) => address ?? [])
        const [documents, readings] = await Promise.all([
          readInternalLinkPreviews(documentLinks.deps, {
            viewer: documentLinks.viewer,
            keys,
            described: new Set(keys),
          }),
          getLinkPreviews(previews, {
            userId,
            urls: asked.flatMap(({ url, address }) => (address === null ? [url] : [])),
          }),
        ])
        const pages = readings.values()
        return {
          previews: asked.map(({ url, address }) => {
            const view = address === null ? pages.next().value?.view : documents.get(address)
            /* v8 ignore next -- every link asked about has exactly one answer above (a reading per
               page address, an entry per document address); the fallback is only there because
               an iterator result and a map lookup are both typed as possibly absent. */
            return { url, view: view ?? UNAVAILABLE }
          }),
        }
      },
    )

    app.post(
      '/api/link-previews/refresh',
      {
        preHandler: app.requireSession,
        schema: {
          body: Type.Object({ url: UrlSchema }, { additionalProperties: false }),
          response: { 200: ViewSchema },
        },
      },
      async (request) => {
        const result = await refreshLinkPreview(previews, {
          userId: requireAuthenticatedSession(request).userId,
          url: request.body.url,
        })
        if (result.ok) return result.value
        switch (result.error) {
          case 'invalid_url': {
            throw unprocessable('invalid_url', 'That is not a link a preview can be made for')
          }
          case 'blocked': {
            throw forbidden('Your organisation does not allow previews of this link')
          }
          case 'rate_limited': {
            // A person pressing refresh is not abusing anything; the allowance refills in seconds.
            throw rateLimited(12_000)
          }
        }
      },
    )
  }
}
