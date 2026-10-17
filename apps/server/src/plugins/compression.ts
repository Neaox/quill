import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'

import type { FastifyInstance } from 'fastify'

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

export function registerCompression(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
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
    return compressed
  })
}

function varyWith(existing: unknown): string {
  const current = typeof existing === 'string' ? existing : ''
  if (/(?:^|,\s*)accept-encoding(?:\s*,|$)/i.test(current)) return current
  return current === '' ? 'accept-encoding' : `${current}, accept-encoding`
}
