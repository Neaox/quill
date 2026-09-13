/**
 * What a request line is allowed to say.
 *
 * Fastify logs every request's method and URL at `info`. A share link carries
 * its token in the path because the token *is* the capability (plan section
 * 14), so an unredacted request line would write live credentials into a log
 * file, a log shipper, and whatever indexes them — the thing ADR-011 forbids
 * in the same breath as it forbids storing tokens ("audit without secrets",
 * "no secrets or full tokens in any log line").
 *
 * The token is replaced rather than the whole line dropped, because the line
 * is still worth having: the path shape, the status, and the timing of an
 * anonymous read are exactly what an operator needs to see abuse.
 */

/** What stands in for a token in a logged URL. */
export const REDACTED = '[redacted]'

/**
 * Every path shape that carries a token, anchored so a query string or a
 * deeper path cannot slip one past: `/api/share/<token>` and anything under
 * it, and the web app's own `/share/<token>` page.
 */
const SHARE_PATH = /^(?<prefix>(?:\/api)?\/share)\/(?<token>[^/?#]+)/

/**
 * The URL with any share-link token in it replaced.
 *
 * Returns the input unchanged when there is nothing to redact, so the common
 * case allocates nothing.
 */
export function redactShareToken(url: string): string {
  return url.replace(SHARE_PATH, (_match, prefix: string) => `${prefix}/${REDACTED}`)
}

/**
 * What Fastify hands a request serialiser: its own request, of which only
 * these four fields are ever logged.
 */
export interface LoggableRequest {
  readonly id: string
  readonly method: string
  readonly url: string
  readonly ip: string
}

/**
 * A type alias rather than an interface: Fastify types a request serialiser's
 * return as an object with an index signature, and only an alias carries the
 * implicit one that makes it assignable.
 */
export type SerialisedRequest = {
  readonly id: string
  readonly method: string
  readonly url: string
  readonly remoteAddress: string
}

/** Fastify's own request fields, with any share-link token in the URL redacted. */
export function serialiseRequest(request: LoggableRequest): SerialisedRequest {
  return {
    id: request.id,
    method: request.method,
    url: redactShareToken(request.url),
    remoteAddress: request.ip,
  }
}
