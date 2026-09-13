import type { FastifyInstance, FastifyRequest } from 'fastify'

import { crossOriginRejected } from '../errors.ts'

/**
 * Cross-site request forgery defence without CSRF tokens (ADR-011).
 *
 * `SameSite=Lax` on a `__Host-` cookie already means the session never
 * travels with a cross-site POST. This is the explicit second check the ADR
 * asks for, because relying on one browser default is relying on one
 * browser default:
 *
 * - `Sec-Fetch-Site`, when the client sends it, must be `same-origin` (the
 *   app's own pages) or `none` (a bookmark, a typed URL).
 * - `Origin`, when present, must be the app's own origin.
 *
 * **The chosen policy for a request with neither header** — `curl`, a CI
 * script, `app.inject` — is that it is a non-browser client, and is allowed
 * only while it carries no session cookie. Every browser released since
 * 2020 sends fetch metadata, so a request that both omits it *and* presents
 * a session cookie is not a browser doing the user's bidding; refusing it
 * costs a scripted client nothing it cannot fix with one header, and closes
 * the gap that "absent means allowed" would otherwise leave.
 */

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export interface CsrfOptions {
  /** The scheme-host-port `Origin` must match, from `config.appOrigin`. */
  readonly appOrigin: string
  readonly cookieName: string
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const raw = request.headers[name]
  return typeof raw === 'string' ? raw : undefined
}

export function registerCsrfProtection(app: FastifyInstance, options: CsrfOptions): void {
  app.addHook('onRequest', async (request) => {
    if (!STATE_CHANGING.has(request.method)) return

    const site = headerValue(request, 'sec-fetch-site')
    const origin = headerValue(request, 'origin')

    if (site !== undefined && site !== 'same-origin' && site !== 'none') {
      throw crossOriginRejected(`sec-fetch-site:${site}`)
    }
    if (origin !== undefined && origin !== options.appOrigin) {
      throw crossOriginRejected('origin-mismatch')
    }
    if (site === undefined && origin === undefined && hasSessionCookie(request, options)) {
      throw crossOriginRejected('missing-fetch-metadata')
    }
  })
}

function hasSessionCookie(request: FastifyRequest, options: CsrfOptions): boolean {
  // `@fastify/cookie` runs at onRequest too; when it has not parsed yet the
  // raw header is still the truth, and is all this check needs.
  const parsed = request.cookies?.[options.cookieName]
  if (parsed !== undefined) return true
  const header = headerValue(request, 'cookie')
  return header !== undefined && header.includes(`${options.cookieName}=`)
}
