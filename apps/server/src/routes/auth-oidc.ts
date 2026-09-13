import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { IdentityProvider, SessionId } from '@quill/application'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'

import { AUDIT_EVENTS, createAuditRecorder } from '../application/audit.ts'
import { createFederatedSignInService } from '../application/federated-sign-in-service.ts'
import type { OidcProviderConfig } from '../auth/oidc/provider-config.ts'
import {
  clearOidcCookie,
  readOidcCookie,
  safeReturnPath,
  setOidcCookie,
} from '../auth/oidc/state-cookie.ts'
import { readSessionCookie, setSessionCookie } from '../auth/session-cookie.ts'
import { hashesMatch, hashSessionToken } from '../auth/session-token.ts'
import { hashToken } from '../auth/tokens.ts'
import type { AppDependencies } from '../dependencies.ts'
import { notFound } from '../errors.ts'
import { addressKey, flatAddressRateLimit } from '../plugins/rate-limit.ts'

/**
 * Sign in with the organisation's provider (plan §23, ADR-011; use case 38).
 *
 * Three routes, and only the first of them is an API call:
 *
 * - `GET /api/auth/oidc/providers` lists what the sign-in page may offer. It
 *   is public and deliberately dull — an id and a label — because it is read
 *   before anybody has signed in and must say nothing about who uses the
 *   instance.
 * - `GET /api/auth/oidc/:id/start` mints the attempt, leaves its secrets in a
 *   short-lived `__Host-` cookie, and redirects to the provider.
 * - `GET /api/auth/oidc/:id/callback` is where the browser comes back. It
 *   checks `state` against the cookie, spends the code, verifies the id
 *   token, links or provisions the account, issues the session, and redirects
 *   into the app.
 *
 * **Every failure looks the same from outside.** A wrong state, a refused
 * code, an unverified email, a provider that will not link, an instance that
 * will not provision — all of them clear the cookie and send the browser to
 * `/sign-in?error=sso`. The distinction is in the audit log, where only an
 * operator can read it, because a browser that could tell "no account here"
 * from "that token was not valid" is an account-enumeration oracle for every
 * address in the directory (ADR-011).
 *
 * **The callback is exempt from the fetch-metadata CSRF check by design**,
 * and is exempt for free: `plugins/csrf.ts` checks state-changing methods
 * only, and this is a `GET`. The design note is in that file — a provider's
 * redirect is a top-level cross-site navigation, so `Sec-Fetch-Site` is
 * `cross-site` and there is no `Origin` to match. What replaces the check is
 * the `state` cookie: nothing in the callback is believed unless this browser
 * is holding the secret this server minted for this attempt.
 */

const ProviderSummarySchema = Type.Object(
  {
    id: Type.String(),
    displayName: Type.String(),
  },
  { $id: 'OidcProviderSummary' },
)

const ProviderListSchema = Type.Object({
  providers: Type.Array(Type.Ref(ProviderSummarySchema)),
})

const ProviderParams = Type.Object({ id: Type.String() })

const StartQuery = Type.Object({
  /** Where to land afterwards. Checked by `safeReturnPath`, never used as given. */
  redirect: Type.Optional(Type.String({ maxLength: 2048 })),
})

/**
 * What a provider may send back. `code` and `state` on success; `error` when
 * the person pressed cancel or the provider refused. Extra parameters (`iss`,
 * `session_state`) are permitted: several providers add them, and refusing an
 * unknown one would break sign-in for reasons that are not security.
 */
const CallbackQuery = Type.Object({
  code: Type.Optional(Type.String({ maxLength: 4096 })),
  state: Type.Optional(Type.String({ maxLength: 512 })),
  error: Type.Optional(Type.String({ maxLength: 256 })),
})

/** The one place a failed single sign-on lands, whatever went wrong. */
const FAILURE_PATH = '/sign-in?error=sso'

/**
 * The two endpoints share one budget per source address, because they are
 * two halves of one act: a flood of `start` with no `callback` costs the same
 * outbound traffic either way. See `ServerConfig.oidcRateLimit`.
 */
const OIDC_BUCKET = 'oidc'

/** A redirect that is never cached and never stored: it carries a one-time state. */
function redirect(reply: FastifyReply, location: string): FastifyReply {
  return reply.header('cache-control', 'no-store').redirect(location, 302)
}

export function oidcAuthRoutes(deps: AppDependencies): FastifyPluginAsync {
  const registry = deps.identityProviders
  const federated = createFederatedSignInService({
    uow: deps.uow,
    clock: deps.clock,
    ids: deps.ids,
    session: deps.config.session,
  })
  const audit = createAuditRecorder(deps)
  const configById = new Map(deps.config.oidcProviders.map((entry) => [entry.id, entry]))

  function providerOr404(id: string): { provider: IdentityProvider; config: OidcProviderConfig } {
    const provider = registry.find(id)
    const config = configById.get(id)
    if (provider === undefined || config === undefined) {
      // Not "forbidden": an id nobody configured must look exactly like an id
      // that does not exist.
      throw notFound('No such sign-in provider')
    }
    return { provider, config }
  }

  /** The session this browser already holds, so a successful sign-in rotates it out. */
  async function currentSessionId(request: FastifyRequest): Promise<SessionId | null> {
    const token = readSessionCookie(request, deps.config.session)
    if (token === undefined) return null
    const authenticated = await deps.uow.repos.sessions.findByTokenHash(hashSessionToken(token))
    return authenticated?.id ?? null
  }

  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()
    app.addSchema(ProviderSummarySchema)

    /**
     * The sign-in page's list. No session, no rate limit worth the name: it
     * is a constant the process already holds, and the page needs it before
     * anybody can be identified.
     */
    app.get(
      '/api/auth/oidc/providers',
      { schema: { response: { 200: ProviderListSchema } } },
      async () => ({
        providers: registry
          .list()
          .map((provider) => ({ id: provider.id, displayName: provider.displayName })),
      }),
    )

    app.get(
      '/api/auth/oidc/:id/start',
      {
        preHandler: flatAddressRateLimit(
          OIDC_BUCKET,
          deps.oidcRateLimiter,
          deps.config.oidcRateLimit,
        ),
        schema: { params: ProviderParams, querystring: StartQuery },
      },
      async (request, reply) => {
        const { provider } = providerOr404(request.params.id)
        const started = await provider.start()
        if (!started.ok) {
          await federated.recordFailure({
            providerId: provider.id,
            reason: started.reason,
            detail: started.detail,
          })
          return redirect(reply, FAILURE_PATH)
        }

        setOidcCookie(
          reply,
          deps.config.session,
          {
            providerId: provider.id,
            state: started.state,
            nonce: started.nonce,
            codeVerifier: started.codeVerifier,
            returnTo: safeReturnPath(request.query.redirect),
          },
          deps.clock.now(),
        )
        await audit.record({
          type: AUDIT_EVENTS.ssoSignInStarted,
          actorUserId: null,
          targetType: 'identity-provider',
          targetId: provider.id,
        })
        return redirect(reply, started.authorizationUrl)
      },
    )

    app.get(
      '/api/auth/oidc/:id/callback',
      {
        preHandler: flatAddressRateLimit(
          OIDC_BUCKET,
          deps.oidcRateLimiter,
          deps.config.oidcRateLimit,
        ),
        schema: { params: ProviderParams, querystring: CallbackQuery },
      },
      async (request, reply) => {
        const { provider, config } = providerOr404(request.params.id)
        const held = readOidcCookie(request, deps.config.session)
        // Spent on sight, whatever happens next: one cookie, one callback.
        clearOidcCookie(reply, deps.config.session)

        async function refuse(reason: string, detail: string): Promise<FastifyReply> {
          await federated.recordFailure({ providerId: provider.id, reason, detail })
          return redirect(reply, FAILURE_PATH)
        }

        if (request.query.error !== undefined) {
          // The person pressed cancel, or the provider refused them. Its own
          // code is recorded; the browser is told nothing.
          return refuse('provider_refused', request.query.error)
        }
        if (held === null || held.providerId !== provider.id) {
          return refuse('state_missing', 'no sign-in attempt is open in this browser')
        }
        const { code, state } = request.query
        if (code === undefined || state === undefined) {
          return refuse('callback_incomplete', 'the callback carried no code or no state')
        }
        // Timing-safe, like every other secret comparison here: `state` is a
        // secret this browser was given and the callback is presenting it.
        if (!hashesMatch(hashToken(held.state), hashToken(state))) {
          return refuse('state_mismatch', 'the state does not match this browser')
        }

        const completed = await provider.complete({
          code,
          state: held.state,
          nonce: held.nonce,
          codeVerifier: held.codeVerifier,
        })
        if (!completed.ok) {
          return refuse(completed.reason, completed.detail)
        }

        const result = await federated.signIn({
          identity: completed.identity,
          providerId: provider.id,
          allowSignUp: config.allowSignUp,
          allowLinking: config.allowLinking,
          previousSessionId: await currentSessionId(request),
        })
        if (!result.ok) {
          // Already audited by the service, with the identity it refused.
          return redirect(reply, FAILURE_PATH)
        }

        setSessionCookie(reply, deps.config.session, result.session.token, deps.clock.now())
        // A completed sign-in clears the budget, so the office behind one NAT
        // that all arrives at nine o'clock does not spend the morning
        // queueing behind itself.
        deps.oidcRateLimiter.reset(addressKey(OIDC_BUCKET, request))
        // Checked again on the way out: the cookie is the browser's, and a
        // browser that edited its own copy must still not be redirected off
        // this application (`safeReturnPath`).
        return redirect(reply, safeReturnPath(held.returnTo))
      },
    )
  }
}
