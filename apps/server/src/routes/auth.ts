import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { SessionId } from '@quill/application'
import type { FastifyPluginAsync } from 'fastify'

import { authServiceFor } from '../application/auth-service.ts'
import type { SessionIssued } from '../application/auth-service.ts'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth/password.ts'
import {
  clearLinkCookie,
  clearSessionCookie,
  readLinkCookie,
  readSessionCookie,
  setLinkCookie,
  setSessionCookie,
} from '../auth/session-cookie.ts'
import type { AppDependencies } from '../dependencies.ts'
import { AppError, notFound } from '../errors.ts'
import {
  accountKey,
  accountKeyFromEmail,
  accountKeyFromSession,
  accountRateLimit,
  addressKey,
  addressRateLimit,
  linkBucket,
} from '../plugins/rate-limit.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'

/**
 * NIST 800-63B, as ADR-011 adopts it: length is the only rule, any Unicode
 * is allowed, and the ceiling exists to bound Argon2id's work, not to
 * discourage passphrases.
 */
const Password = Type.String({
  minLength: PASSWORD_MIN_LENGTH,
  maxLength: PASSWORD_MAX_LENGTH,
})

const SignUpBody = Type.Object({
  email: Type.String({ format: 'email' }),
  password: Password,
  displayName: Type.String({ minLength: 1 }),
})

const SignInBody = Type.Object({
  email: Type.String({ format: 'email' }),
  password: Type.String({ maxLength: PASSWORD_MAX_LENGTH }),
})

/**
 * The public endpoint issues sign-in links and nothing else.
 *
 * It used to take any purpose, which made it a second, separately-limited
 * route to reset mail and to verification mail (review finding M7).
 * Verification links come from sign-up and reset links from
 * `/api/auth/password-reset/request`, each with its own bucket.
 */
const MagicLinkRequestBody = Type.Object({
  email: Type.String({ format: 'email' }),
  purpose: Type.Optional(Type.Literal('sign-in')),
})

/**
 * A presented link. `confirm` is the explicit "yes, it was me" that ADR-011
 * allows in place of the browser that asked for the link — what the web app
 * sends after showing a confirmation screen, and what a mail scanner
 * following the link never sends.
 */
const TokenBody = Type.Object({
  token: Type.String({ minLength: 1, maxLength: 512 }),
  confirm: Type.Optional(Type.Boolean()),
})

const ResetPasswordBody = Type.Object({
  token: Type.String({ minLength: 1, maxLength: 512 }),
  confirm: Type.Optional(Type.Boolean()),
  newPassword: Password,
})

const ChangePasswordBody = Type.Object({
  currentPassword: Type.String({ maxLength: PASSWORD_MAX_LENGTH }),
  newPassword: Password,
})

const SessionSummarySchema = Type.Object(
  {
    id: Type.String(),
    createdAt: Type.String({ format: 'date-time' }),
    lastSeenAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    expiresAt: Type.String({ format: 'date-time' }),
    current: Type.Boolean(),
  },
  { $id: 'SessionSummary' },
)

const SessionListSchema = Type.Object({ sessions: Type.Array(Type.Ref(SessionSummarySchema)) })

const SessionIdParams = Type.Object({ id: Type.String() })

/**
 * The one message a rejected sign-in, sign-up, or reset may carry. It says
 * nothing about whether the account exists, which is the whole point
 * (ADR-011, no account enumeration).
 */
const BREACHED_PASSWORD_MESSAGE =
  'That password has appeared in a known data breach. Please choose a different one.'

/**
 * What the caller is told when a link arrives without the cookie that says
 * this browser asked for it. Deliberately not a failure of the token: the
 * client shows a confirmation and posts the same token again with
 * `confirm: true`.
 */
const CONFIRMATION_MESSAGE =
  'Open this link in the browser that asked for it, or confirm that you meant to use it here'

/**
 * Sign up and sign in with email/password, magic links, password reset and
 * change, email verification, session management, and sign out (plan §23,
 * ADR-011).
 *
 * Every endpoint here answers in the same shape whether or not the account
 * exists, and every one of them is rate limited on two keys — the source
 * address and the account named — with a window that grows for a key that
 * keeps failing rather than a lockout an attacker could aim at a victim.
 */
export function authRoutes(deps: AppDependencies): FastifyPluginAsync {
  const authService = authServiceFor(deps)

  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()
    app.addSchema(SessionSummarySchema)

    function establish(
      reply: Parameters<typeof setSessionCookie>[0],
      session: SessionIssued,
    ): void {
      setSessionCookie(reply, deps.config.session, session.token, deps.clock.now())
      // The binding is spent: one cookie authorises one consumption.
      clearLinkCookie(reply, deps.config.session)
    }

    /** Every link request answers `202 {}` and leaves the same cookie behind. */
    function bind(reply: Parameters<typeof setLinkCookie>[0], binding: string): void {
      setLinkCookie(reply, deps.config.session, binding, deps.clock.now())
    }

    app.post(
      '/api/auth/sign-up',
      {
        config: addressRateLimit('sign-up'),
        preHandler: accountRateLimit('sign-up', accountKeyFromEmail),
        schema: { body: SignUpBody },
      },
      async (request, reply) => {
        const result = await authService.signUp(request.body)
        if (!result.ok) {
          throw new AppError(400, 'breached_password', BREACHED_PASSWORD_MESSAGE)
        }
        // Always 202, always empty, always the same cookie: a caller cannot
        // tell a new account from an existing one, and the person who owns the
        // address is told by email.
        bind(reply, result.binding)
        reply.status(202)
        return {}
      },
    )

    app.post(
      '/api/auth/sign-in',
      {
        config: addressRateLimit('sign-in'),
        preHandler: accountRateLimit('sign-in', accountKeyFromEmail),
        schema: { body: SignInBody },
      },
      async (request, reply) => {
        const result = await authService.signIn(request.body)
        if (!result.ok) {
          throw new AppError(401, 'invalid_credentials', 'Incorrect email or password')
        }
        // A correct password clears both buckets, so somebody who mistypes
        // theirs twice does not carry a half-spent budget — and a doubled
        // window — into the rest of their day.
        deps.rateLimiter.reset(addressKey('sign-in', request))
        deps.rateLimiter.reset(accountKey('sign-in', request.body.email))
        establish(reply, result.session)
        return { userId: result.session.userId }
      },
    )

    app.post('/api/auth/sign-out', async (request, reply) => {
      const token = readSessionCookie(request, deps.config.session)
      if (token !== undefined) {
        const authenticated = await authService.sessions.authenticate(token)
        if (authenticated.ok) {
          await authService.signOut(authenticated.session.id, authenticated.session.userId)
        }
      }
      clearSessionCookie(reply, deps.config.session)
      reply.status(204)
    })

    app.post(
      '/api/auth/magic-link',
      {
        config: addressRateLimit(linkBucket('sign-in')),
        preHandler: accountRateLimit(linkBucket('sign-in'), accountKeyFromEmail),
        schema: { body: MagicLinkRequestBody },
      },
      async (request, reply) => {
        const { binding } = await authService.requestMagicLink(request.body.email, 'sign-in')
        bind(reply, binding)
        reply.status(202)
        return {}
      },
    )

    app.post(
      '/api/auth/magic-link/consume',
      { config: addressRateLimit('link-consume'), schema: { body: TokenBody } },
      async (request, reply) => {
        const result = await authService.consumeSignInLink({
          token: request.body.token,
          binding: readLinkCookie(request, deps.config.session) ?? null,
          confirm: request.body.confirm === true,
        })
        if (!result.ok) {
          if (result.reason === 'confirmation_required') {
            throw new AppError(403, 'confirmation_required', CONFIRMATION_MESSAGE)
          }
          throw new AppError(
            400,
            result.reason,
            'That sign-in link is invalid, expired, or already used',
          )
        }
        establish(reply, result.session)
        return { userId: result.session.userId }
      },
    )

    app.post(
      '/api/auth/verify-email',
      { config: addressRateLimit('link-consume'), schema: { body: TokenBody } },
      async (request, reply) => {
        const result = await authService.verifyEmail({
          token: request.body.token,
          binding: readLinkCookie(request, deps.config.session) ?? null,
          confirm: request.body.confirm === true,
        })
        if (!result.ok) {
          if (result.reason === 'confirmation_required') {
            throw new AppError(403, 'confirmation_required', CONFIRMATION_MESSAGE)
          }
          throw new AppError(
            400,
            result.reason,
            'That verification link is invalid, expired, or already used',
          )
        }
        clearLinkCookie(reply, deps.config.session)
        return {}
      },
    )

    app.post(
      '/api/auth/password-reset/request',
      {
        config: addressRateLimit(linkBucket('password-reset')),
        preHandler: accountRateLimit(linkBucket('password-reset'), accountKeyFromEmail),
        schema: { body: Type.Object({ email: Type.String({ format: 'email' }) }) },
      },
      async (request, reply) => {
        const { binding } = await authService.requestPasswordReset(request.body.email)
        bind(reply, binding)
        reply.status(202)
        return {}
      },
    )

    app.post(
      '/api/auth/password-reset/confirm',
      { config: addressRateLimit('link-consume'), schema: { body: ResetPasswordBody } },
      async (request, reply) => {
        const result = await authService.resetPassword({
          token: request.body.token,
          binding: readLinkCookie(request, deps.config.session) ?? null,
          confirm: request.body.confirm === true,
          newPassword: request.body.newPassword,
        })
        if (!result.ok) {
          if (result.reason === 'breached_password') {
            throw new AppError(400, 'breached_password', BREACHED_PASSWORD_MESSAGE)
          }
          if (result.reason === 'confirmation_required') {
            throw new AppError(403, 'confirmation_required', CONFIRMATION_MESSAGE)
          }
          throw new AppError(
            400,
            result.reason,
            'That reset link is invalid, expired, or already used',
          )
        }
        clearLinkCookie(reply, deps.config.session)
        return {}
      },
    )

    /**
     * Changing a password while signed in. Additive (ADR-033): a new path,
     * nothing existing moved. Re-authentication is required, every other
     * session is revoked, and this one is rotated.
     */
    app.post(
      '/api/auth/password',
      {
        preHandler: [
          app.requireSession,
          accountRateLimit('password-change', accountKeyFromSession),
        ],
        config: addressRateLimit('password-change'),
        schema: { body: ChangePasswordBody, response: { 200: Type.Object({}) } },
      },
      async (request, reply) => {
        const session = requireAuthenticatedSession(request)
        const result = await authService.changePassword({
          user: session.userId,
          sessionId: session.sessionId,
          currentPassword: request.body.currentPassword,
          newPassword: request.body.newPassword,
        })
        if (!result.ok) {
          if (result.reason === 'breached_password') {
            throw new AppError(400, 'breached_password', BREACHED_PASSWORD_MESSAGE)
          }
          throw new AppError(401, 'invalid_credentials', 'Incorrect password')
        }
        establish(reply, result.session)
        return {}
      },
    )

    app.get(
      '/api/auth/sessions',
      {
        preHandler: app.requireSession,
        schema: { response: { 200: SessionListSchema } },
      },
      async (request) => {
        const session = requireAuthenticatedSession(request)
        const rows = await authService.listSessions(session.userId)
        return {
          sessions: rows.map((row) => ({
            id: row.id,
            createdAt: row.createdAt.toISOString(),
            lastSeenAt: row.lastSeenAt === null ? null : row.lastSeenAt.toISOString(),
            expiresAt: row.expiresAt.toISOString(),
            current: row.id === session.sessionId,
          })),
        }
      },
    )

    app.delete(
      '/api/auth/sessions/:id',
      { preHandler: app.requireSession, schema: { params: SessionIdParams } },
      async (request, reply) => {
        const session = requireAuthenticatedSession(request)
        const revoked = await authService.revokeSession(
          session.userId,
          request.params.id as SessionId,
        )
        // Another user's session is "not found", never "forbidden": the
        // caller must not learn that the id exists.
        if (!revoked) throw notFound('Session not found')
        if (request.params.id === session.sessionId) {
          clearSessionCookie(reply, deps.config.session)
        }
        reply.status(204)
      },
    )

    /** Sign out everywhere, this session included. */
    app.delete('/api/auth/sessions', { preHandler: app.requireSession }, async (request, reply) => {
      const session = requireAuthenticatedSession(request)
      await authService.signOutEverywhere(session.userId)
      clearSessionCookie(reply, deps.config.session)
      reply.status(204)
    })
  }
}
