import type { FastifyReply, FastifyRequest } from 'fastify'

import type { SessionConfig } from '../../config.ts'

/**
 * The short-lived cookie one OIDC round trip is bound to (ADR-011: "`state`
 * and `nonce` checked").
 *
 * `state` in the callback query is only meaningful against something the
 * browser kept, and this is that something: an `HttpOnly`, `SameSite=Lax`,
 * `__Host-` cookie holding the state the authorisation request carried, the
 * nonce the id token must repeat, the PKCE verifier the token exchange will
 * spend, the provider it all belongs to, and where to go afterwards.
 *
 * It is not signed, and does not need to be. Everything in it is a secret
 * *this browser* was given; an attacker who can write cookies into somebody's
 * browser can only make that browser's own sign-in attempt fail, which is the
 * login-CSRF this cookie exists to prevent in the first place. What matters
 * is that the callback's `state` equals the cookie's, and that both were
 * minted by this server for this attempt.
 *
 * It lives ten minutes. A person who wanders off mid-sign-in starts again
 * rather than leaving a usable verifier in a browser overnight.
 */

export const OIDC_COOKIE_TTL_MS = 10 * 60 * 1000

export interface OidcSignInState {
  readonly providerId: string
  readonly state: string
  readonly nonce: string
  readonly codeVerifier: string
  /** A path inside this app, already checked by `safeReturnPath`. */
  readonly returnTo: string
}

function attributes(session: SessionConfig): {
  httpOnly: true
  sameSite: 'lax'
  secure: boolean
  path: '/'
} {
  return { httpOnly: true, sameSite: 'lax', secure: session.secureCookie, path: '/' }
}

export function setOidcCookie(
  reply: FastifyReply,
  session: SessionConfig,
  state: OidcSignInState,
  now: Date,
): void {
  reply.setCookie(
    session.oidcCookieName,
    Buffer.from(JSON.stringify(state), 'utf8').toString('base64url'),
    { ...attributes(session), expires: new Date(now.getTime() + OIDC_COOKIE_TTL_MS) },
  )
}

/** Spent the moment it is read: one cookie authorises one callback. */
export function clearOidcCookie(reply: FastifyReply, session: SessionConfig): void {
  reply.clearCookie(session.oidcCookieName, attributes(session))
}

export function readOidcCookie(
  request: FastifyRequest,
  session: SessionConfig,
): OidcSignInState | null {
  const raw = request.cookies[session.oidcCookieName]
  if (raw === undefined) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const candidate = parsed as Record<string, unknown>
  const fields = ['providerId', 'state', 'nonce', 'codeVerifier', 'returnTo'] as const
  if (!fields.every((field) => typeof candidate[field] === 'string')) return null
  return parsed as OidcSignInState
}

/**
 * Where the browser goes after a successful sign-in.
 *
 * Only a path inside this application, so the `redirect` on the start route
 * cannot be turned into an open redirect that sends somebody — freshly
 * authenticated, cookie set — to a page that looks like this one. A
 * protocol-relative `//evil.example` is a URL, not a path, which is why the
 * second character is checked too.
 */
export function safeReturnPath(candidate: string | undefined): string {
  if (candidate === undefined) return '/'
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return '/'
  // A backslash is a path separator to some browsers' URL parsers, so
  // `/\evil.example` is another spelling of protocol-relative.
  if (candidate.startsWith('/\\')) return '/'
  return candidate
}
