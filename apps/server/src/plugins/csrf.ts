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
 *
 * **The OIDC callback is exempt, by design.** `GET
 * /api/auth/oidc/:id/callback` is where an identity provider returns the
 * browser after a sign-in, and that is a *top-level cross-site navigation*:
 * `Sec-Fetch-Site` is `cross-site` and there is no same-origin `Origin` to
 * match, so this check would refuse every real sign-in. It is exempt for
 * free, because the hook only runs for state-changing methods and the
 * callback is a `GET` — but the exemption is deliberate and is written down
 * here so nobody "fixes" it by widening the hook to `GET` later.
 *
 * What takes this check's place there is a secret rather than a header. The
 * callback believes nothing unless the browser presents the short-lived
 * `__Host-` cookie this server minted for that attempt, and unless the
 * `state` in the query matches the one inside it
 * (`auth/oidc/state-cookie.ts`). A cross-site request to the callback has no
 * such cookie, so it is refused — which is login CSRF closed by the same
 * mechanism the OpenID Connect specification asks for. The callback changes
 * state, so it must never become anything but that: it is a `GET` only
 * because a redirect is a `GET`.
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
