import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'

import type { FastifyInstance, FastifyReply, FastifyRequest, onSendHookHandler } from 'fastify'

/**
 * Compresses the API's text responses on the way out.
 *
 * The workspace tree of a large workspace is megabytes of JSON, and nothing
 * else in front of the server could be relied on to compress it — the dev
 * proxy passes responses through as they are, and a deployment may have no
 * proxy at all. Node's own `zlib` does the work, so this is an `onSend` hook
 * rather than another dependency (AGENTS.md rule 11).
 *
 * Only what is safe and worth it is compressed (ADR-011): a successful `GET`
 * of text above a kilobyte, when the client asks. A response that sets a
 * cookie or is marked `no-store` is left alone, because compressing a secret
 * alongside text an attacker can influence leaks the secret through the
 * response's size (BREACH); and so is anything already encoded.
 *
 * The check has to see every header the response will leave with, so the
 * compression runs after every other `onSend` hook: it is added to each
 * route as a route-level hook, the last stage Fastify runs, after the hooks
 * of the instance and of every plugin the route is registered in, whenever
 * those were added. A hook that sets a cookie can never run after it.
 *
 * A compressed response is a different representation from the one its
 * strong `ETag` names (RFC 9110, 8.8.3), so it gets a validator of its own,
 * `"<tag>-br"` or `"<tag>-gzip"`. A conditional request naming the validator
 * of the encoding it would be sent is read as naming the route's own, so the
 * route answers `304` as it always did, and that `304` carries the encoded
 * validator back.
 */

/** Below this a response gains nothing worth the CPU. */
const MIN_BYTES = 1_024

const COMPRESSIBLE = /^(?:application\/(?:json|javascript|xml)|text\/|image\/svg\+xml)/

const brotli = promisify(brotliCompress)
const gzipAsync = promisify(gzip)

export type ContentEncoding = 'br' | 'gzip'

/** The best encoding `accept-encoding` allows, brotli first; `undefined` for none. */
export function negotiateEncoding(header: string | undefined): ContentEncoding | undefined {
  if (header === undefined) return undefined
  const accepted = new Map(
    header.split(',').map((part) => {
      const [name = '', ...parameters] = part.trim().toLowerCase().split(';')
      const quality = parameters
        .map((parameter) => /^\s*q=([0-9.]+)\s*$/.exec(parameter)?.[1])
        .find((value) => value !== undefined)
      return [name.trim(), quality === undefined ? 1 : Number(quality)] as const
    }),
  )
  return (['br', 'gzip'] as const).find((name) => (accepted.get(name) ?? 0) > 0)
}

function textOf(payload: unknown): Buffer | undefined {
  if (typeof payload === 'string') return Buffer.from(payload)
  if (Buffer.isBuffer(payload)) return payload
  return undefined
}

/** A strong entity tag, `"…"`; a weak one (`W/"…"`) promises only equivalence and is left alone. */
const STRONG_TAG = /^"([^"]*)"$/

/** A strong entity tag that names one encoding of a representation: `"<tag>-br"`. */
const ENCODED_TAG = /^"([^"]*)-(br|gzip)"$/

/** The validator of one encoding of a representation with this strong tag. */
function encodedTag(tag: string, encoding: ContentEncoding): string | undefined {
  const opaque = STRONG_TAG.exec(tag)?.[1]
  return opaque === undefined ? undefined : `"${opaque}-${encoding}"`
}

/** The requests whose `If-None-Match` named an encoded validator, and which encoding. */
const conditionalEncodings = new WeakMap<FastifyRequest, ContentEncoding>()

/**
 * Reads `If-None-Match: "<tag>-br"` as `"<tag>"` when brotli is what this
 * request would be sent, so the route's own comparison holds; a validator of
 * another encoding is left as it is, and does not match.
 */
function readConditional(request: FastifyRequest): void {
  const header = request.headers['if-none-match']
  if (header === undefined) return
  const [, tag, named] = ENCODED_TAG.exec(header.trim()) ?? []
  const encoding = negotiateEncoding(request.headers['accept-encoding'])
  if (tag === undefined || encoding === undefined || named !== encoding) return
  request.headers['if-none-match'] = `"${tag}"`
  conditionalEncodings.set(request, encoding)
}

/** A `304` to a conditional that named an encoded validator names it back. */
function answerConditional(request: FastifyRequest, reply: FastifyReply): void {
  const encoding = conditionalEncodings.get(request)
  const tag = reply.getHeader('etag')
  if (encoding === undefined || typeof tag !== 'string') return
  const encoded = encodedTag(tag, encoding)
  if (encoded !== undefined) void reply.header('etag', encoded)
}

const compress: onSendHookHandler = async (request, reply, payload) => {
  if (request.method === 'GET' && reply.statusCode === 304) {
    answerConditional(request, reply)
    return payload
  }
  if (request.method !== 'GET' || reply.statusCode < 200 || reply.statusCode >= 300) {
    return payload
  }
  if (
    reply.hasHeader('content-encoding') ||
    reply.hasHeader('set-cookie') ||
    String(reply.getHeader('cache-control') ?? '').includes('no-store') ||
    !COMPRESSIBLE.test(String(reply.getHeader('content-type') ?? ''))
  ) {
    return payload
  }
  const body = textOf(payload)
  if (body === undefined || body.length < MIN_BYTES) return payload
  const encoding = negotiateEncoding(request.headers['accept-encoding'])
  void reply.header('vary', varyWith(reply.getHeader('vary')))
  if (encoding === undefined) return payload

  const compressed =
    encoding === 'br'
      ? await brotli(body, {
          params: {
            // Fast rather than smallest: this runs per request.
            [constants.BROTLI_PARAM_QUALITY]: 4,
            [constants.BROTLI_PARAM_SIZE_HINT]: body.length,
          },
        })
      : await gzipAsync(body, { level: 6 })
  void reply.header('content-encoding', encoding)
  void reply.removeHeader('content-length')
  const tag = reply.getHeader('etag')
  const encoded = typeof tag === 'string' ? encodedTag(tag, encoding) : undefined
  if (encoded !== undefined) void reply.header('etag', encoded)
  return compressed
}

export function registerCompression(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    if (request.method === 'GET') readConditional(request)
  })
  // Last of all: see the module comment.
  app.addHook('onRoute', (route) => {
    const own = route.onSend ?? []
    route.onSend = [...(Array.isArray(own) ? own : [own]), compress]
  })
}

/** `Vary` with `accept-encoding` in it once, keeping every value it had, however it was set. */
function varyWith(existing: unknown): string {
  const current = Array.isArray(existing)
    ? existing.map(String).join(', ')
    : typeof existing === 'string'
      ? existing
      : ''
  if (/(?:^|,\s*)accept-encoding(?:\s*,|$)/i.test(current)) return current
  return current === '' ? 'accept-encoding' : `${current}, accept-encoding`
}
