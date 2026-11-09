import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { SOURCE_WEBHOOK_FORGES, receiveSourceWebhook } from '@quill/application'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'

import type { AppDependencies } from '../dependencies.ts'
import { AppError } from '../errors.ts'
import { addressRateLimit } from '../plugins/rate-limit.ts'

/**
 * A forge's push webhook for a sourced workspace (ADR-061, "Freshness"):
 * `POST /api/workspaces/:id/source/webhooks/:forge`, with `:forge` `github`
 * or `gitlab`. It is public, because a forge has no session; what stands in
 * for one is the signature, checked against the source's webhook secret
 * before anything else in the delivery is read.
 *
 * - **The body is kept raw.** The signature covers the bytes the forge sent,
 *   so this route's own content-type parser hands them over unparsed, for
 *   every content type, and the use case reads JSON only once they verify.
 * - **Every refusal is the same refusal.** An unknown workspace, a native
 *   one, a source with no webhook secret and a wrong signature all answer
 *   `401 invalid_signature`, with the same words, so the route says nothing
 *   about which workspaces exist or take webhooks.
 * - **It answers `202` without fetching.** A push asks for a sync on the
 *   outbox and returns; the sync job runs off this request.
 * - **It is rate-limited by address,** not by workspace, so nobody can spend
 *   a workspace's budget and shut its real deliveries out.
 */

/** Deliveries one address may make in the limiter's window: a busy repository's pushes, with room. */
const DELIVERIES_PER_WINDOW = 60

/**
 * GitHub caps a push payload at 25 MB, but one that large lists thousands of
 * commits the job never reads; a delivery refused for its size is caught up
 * by the next one or by the daily reconciliation.
 */
const MAX_DELIVERY_BYTES = 2 * 1024 * 1024

const ParamsSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 200 }),
  forge: Type.Union(SOURCE_WEBHOOK_FORGES.map((forge) => Type.Literal(forge))),
})

const AcceptedSchema = Type.Object({
  /** What came of it: a sync asked for, a delivery seen before, or an event or branch it does not act on. */
  outcome: Type.Union([
    Type.Literal('requested'),
    Type.Literal('duplicate'),
    Type.Literal('ignored'),
  ]),
})

const invalidSignature = (): AppError =>
  new AppError(401, 'invalid_signature', 'The delivery could not be verified')

const invalidDelivery = (): AppError =>
  new AppError(400, 'invalid_delivery', 'The delivery has no id, or no ref of a push')

/** The request's headers by lower-case name, as plain strings. */
function headersOf(request: FastifyRequest): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? value[0] : value,
    ]),
  )
}

export function sourceWebhookRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    // Only in this plugin's context: every other route keeps the JSON parser.
    app.removeAllContentTypeParsers()
    app.addContentTypeParser(
      '*',
      { parseAs: 'buffer', bodyLimit: MAX_DELIVERY_BYTES },
      (_request, body, done) => {
        done(null, body)
      },
    )

    app.post(
      '/api/workspaces/:id/source/webhooks/:forge',
      {
        config: addressRateLimit('source-webhook', DELIVERIES_PER_WINDOW),
        bodyLimit: MAX_DELIVERY_BYTES,
        schema: { params: ParamsSchema, response: { 202: AcceptedSchema } },
      },
      async (request, reply) => {
        const body = request.body instanceof Buffer ? request.body : Buffer.alloc(0)
        const result = await receiveSourceWebhook(
          { ...deps, authenticator: deps.messageAuthenticator },
          {
            workspaceId: request.params.id,
            forge: request.params.forge,
            headers: headersOf(request),
            body: new Uint8Array(body),
          },
        )
        switch (result.kind) {
          case 'refused':
            throw invalidSignature()
          case 'malformed':
            throw invalidDelivery()
          case 'ignored':
          case 'duplicate':
          case 'requested':
            reply.status(202)
            return { outcome: result.kind }
        }
      },
    )
  }
}
