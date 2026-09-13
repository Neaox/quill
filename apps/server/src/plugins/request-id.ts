import { randomUUID } from 'node:crypto'
import type { FastifyInstance, RawRequestDefaultExpression } from 'fastify'

/**
 * The request id: honoured from a proxy so a request can be traced across the
 * edge, generated otherwise.
 *
 * A caller-supplied id is echoed in a response header and written into every
 * log line for the request, so it is attacker-controlled text reaching two
 * places that read it. It is therefore taken only when the deployment says
 * there *is* a proxy in front (`TRUST_PROXY`), and even then only when it is
 * short and made of the characters a correlation id is made of — anything
 * else is replaced with a generated one rather than refused, because a
 * malformed trace header must not fail a request.
 */

/** Long enough for a UUID, a W3C trace id, or a cloud request id; short enough to log. */
export const MAX_REQUEST_ID_LENGTH = 128

/** The charset every correlation id format in use here shares. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/

export interface RequestIdOptions {
  /**
   * Whether anything in front of this server is trusted at all. False means
   * the socket peer is the client, and a client does not get to choose what
   * this server's logs call its request.
   */
  readonly trustProxy: boolean
}

export interface RequestIdGenerator {
  (raw: RawRequestDefaultExpression): string
}

export function createRequestIdGenerator(options: RequestIdOptions): RequestIdGenerator {
  return (raw: RawRequestDefaultExpression): string => {
    if (!options.trustProxy) return randomUUID()
    const header = raw.headers['x-request-id']
    const supplied = Array.isArray(header) ? header[0] : header
    if (
      supplied === undefined ||
      supplied.length === 0 ||
      supplied.length > MAX_REQUEST_ID_LENGTH ||
      !REQUEST_ID_PATTERN.test(supplied)
    ) {
      return randomUUID()
    }
    return supplied
  }
}

/** Echoes the request id back so a caller that didn't supply one still gets it. */
export function registerRequestIdHeader(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id)
    return payload
  })
}
