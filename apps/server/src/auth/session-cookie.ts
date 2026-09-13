import type { FastifyReply, FastifyRequest } from 'fastify'

import type { SessionConfig } from '../config.ts'

/**
 * How long the "you asked for this link here" cookie lives: the same fifteen
 * minutes the link itself does (ADR-011), so it cannot outlive what it binds.
 */
export const LINK_COOKIE_TTL_MS = 15 * 60 * 1000

/**
 * The attributes every cookie this server sets carries.
 *
 * They are stated once because *clearing* a cookie has to repeat them: a
 * browser matches a deletion against the attributes it was set with, and a
 * `__Host-` cookie cleared without `Secure` is simply not deleted — the stale
 * cookie survives a sign-out, which is the opposite of what sign-out means.
 */
function attributes(session: SessionConfig): {
  httpOnly: true
  sameSite: 'lax'
  secure: boolean
  path: '/'
} {
  return { httpOnly: true, sameSite: 'lax', secure: session.secureCookie, path: '/' }
}

export function setSessionCookie(
  reply: FastifyReply,
  session: SessionConfig,
  sessionId: string,
  now: Date,
): void {
  reply.setCookie(session.cookieName, sessionId, {
    ...attributes(session),
    expires: new Date(now.getTime() + session.ttlMs),
  })
}

export function clearSessionCookie(reply: FastifyReply, session: SessionConfig): void {
  reply.clearCookie(session.cookieName, attributes(session))
}

export function readSessionCookie(
  request: FastifyRequest,
  session: SessionConfig,
): string | undefined {
  return request.cookies[session.cookieName]
}

/**
 * The short-lived secret that says a magic link was asked for *in this
 * browser* (ADR-011: "consuming it requires the same browser or an explicit
 * confirmation step").
 *
 * A link opened by a mail scanner, a link-preview bot, or a corporate
 * security appliance arrives without this cookie, so it cannot sign anybody
 * in or spend a reset token by itself; the person who really clicked gets an
 * explicit "yes, it was me" step instead.
 */
export function setLinkCookie(
  reply: FastifyReply,
  session: SessionConfig,
  binding: string,
  now: Date,
): void {
  reply.setCookie(session.linkCookieName, binding, {
    ...attributes(session),
    expires: new Date(now.getTime() + LINK_COOKIE_TTL_MS),
  })
}

export function readLinkCookie(
  request: FastifyRequest,
  session: SessionConfig,
): string | undefined {
  return request.cookies[session.linkCookieName]
}

/** Spent with the link it bound: one cookie can authorise one consumption. */
export function clearLinkCookie(reply: FastifyReply, session: SessionConfig): void {
  reply.clearCookie(session.linkCookieName, attributes(session))
}
