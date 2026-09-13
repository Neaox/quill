import { randomBytes } from 'node:crypto'

import type {
  Clock,
  CompleteSignInResult,
  FederatedIdentity,
  IdentityProvider,
  SignInBinding,
  StartSignInResult,
} from '@quill/application'

import {
  createMetadataCache,
  DEFAULT_METADATA_TTL_MS,
  DEFAULT_MIN_KEY_REFRESH_INTERVAL_MS,
  describe,
} from './discovery.ts'
import type { DiscoveryDocument, MetadataCache, OutboundClientFactory } from './discovery.ts'
import { verifyIdToken } from './id-token.ts'
import type { IdTokenClaims } from './id-token.ts'
import { CODE_CHALLENGE_METHOD, codeChallenge, createCodeVerifier } from './pkce.ts'
import { providerVariablePrefix } from './provider-config.ts'
import type { OidcProviderConfig } from './provider-config.ts'
import type { SecretResolver } from '../../infrastructure/secrets/resolve-secret.ts'

/**
 * The one OpenID Connect implementation (ADR-011). Every provider in the
 * preset registry is this code with different data behind it.
 *
 * The flow it implements is Authorization Code with PKCE and nothing else:
 * `response_type=code`, `code_challenge_method=S256`, `state` and `nonce`
 * minted per attempt, the code exchanged from the server with the client
 * secret, and the id token verified against the provider's published keys
 * before a single claim in it is believed. No token ever reaches the browser
 * and none is persisted; what leaves this module is claims.
 *
 * Every outbound call goes through the SSRF-safe client
 * (`infrastructure/http/outbound-client.ts`), on an allowlist built from the
 * issuer and from the endpoints its own discovery document names.
 */

/** How much disagreement between this clock and the provider's is tolerated. */
export const DEFAULT_CLOCK_SKEW_MS = 60_000

export interface OidcProviderDeps {
  readonly config: OidcProviderConfig
  /** Where the provider sends the browser back: `<appUrl>/api/auth/oidc/<id>/callback`. */
  readonly redirectUri: string
  readonly createClient: OutboundClientFactory
  readonly clock: Clock
  /**
   * Resolves `config.clientSecretName` at the moment of use — the token
   * exchange, and only then (ADR-034) — falling back to
   * `config.clientSecretEnvValue` for one release when nothing is stored.
   */
  readonly secretResolver: SecretResolver
  readonly metadataTtlMs?: number
  readonly minKeyRefreshIntervalMs?: number
  readonly clockSkewMs?: number
}

/** 256 bits, the same strength as every other unguessable value the platform mints. */
function secret(): string {
  return randomBytes(32).toString('base64url')
}

interface TokenResponse {
  readonly idToken: string
}

type TokenExchange =
  | { readonly ok: true; readonly tokens: TokenResponse }
  | { readonly ok: false; readonly detail: string }

/**
 * `client_secret_basic` unless the provider says it only takes the secret in
 * the body. Basic is the specification's default when a provider does not
 * publish the list at all, and it keeps the secret out of a body that some
 * proxies log.
 */
function usesBasicAuth(discovery: DiscoveryDocument): boolean {
  const methods = discovery.tokenEndpointAuthMethods
  if (methods.length === 0) return true
  return methods.includes('client_secret_basic')
}

/**
 * RFC 6749 Appendix B: the client id and secret are
 * `application/x-www-form-urlencoded` *before* they are base64-encoded, which
 * matters for the secrets providers really issue.
 *
 * That encoding is not `encodeURIComponent`: a space is `+` rather than
 * `%20`, and `!`, `*`, `'`, `(` and `)` are escaped where
 * `encodeURIComponent` leaves them alone. Getting it wrong means a client
 * whose secret happens to contain one of those characters authenticates
 * everywhere except here, which is a bad afternoon for whoever configured it.
 */
function formUrlencode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(/[!*'()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

function basicCredentials(clientId: string, clientSecret: string): string {
  const encoded = `${formUrlencode(clientId)}:${formUrlencode(clientSecret)}`
  return Buffer.from(encoded, 'utf8').toString('base64')
}

function readErrorCode(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const code = (parsed as Record<string, unknown>)['error']
      if (typeof code === 'string') return code
    }
  } catch {
    // A token endpoint that answers with something other than JSON has
    // nothing useful to quote, and its body is the last thing to put in a log.
  }
  return 'no error code'
}

/** The groups claim, whether the provider spells it as an array or a space-separated string. */
function readGroups(claims: IdTokenClaims, claimName: string | null): readonly string[] {
  if (claimName === null) return []
  const value = claims[claimName]
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string')
  }
  if (typeof value === 'string' && value.length > 0) return value.split(' ')
  return []
}

function readString(claims: IdTokenClaims, name: string): string | null {
  const value = claims[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * `email_verified` is a boolean in the specification, and a string in more
 * than one real provider. Anything else is "not verified", which is the safe
 * reading: this flag is what decides whether an email may be used to link to
 * an existing account (ADR-011).
 */
function readVerified(claims: IdTokenClaims, name: string): boolean {
  const value = claims[name]
  return value === true || value === 'true'
}

export function createOidcIdentityProvider(deps: OidcProviderDeps): IdentityProvider {
  const { config, redirectUri, clock } = deps
  const clockSkewMs = deps.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS
  const metadata: MetadataCache = createMetadataCache({
    issuer: config.issuer,
    createClient: deps.createClient,
    clock,
    ttlMs: deps.metadataTtlMs ?? DEFAULT_METADATA_TTL_MS,
    minRefreshIntervalMs: deps.minKeyRefreshIntervalMs ?? DEFAULT_MIN_KEY_REFRESH_INTERVAL_MS,
  })

  async function exchange(
    discovery: DiscoveryDocument,
    code: string,
    codeVerifier: string,
  ): Promise<TokenExchange> {
    const resolved = await deps.secretResolver.resolve({
      name: config.clientSecretName,
      envVarName: `${providerVariablePrefix(config.id)}CLIENT_SECRET`,
      envValue: config.clientSecretEnvValue,
    })
    if (!resolved.ok) {
      return {
        ok: false,
        detail: `the client secret is not configured (${config.clientSecretName})`,
      }
    }
    const clientSecret = resolved.value

    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      client_id: config.clientId,
    })
    const headers: Record<string, string> = { accept: 'application/json' }
    if (usesBasicAuth(discovery)) {
      headers['authorization'] = `Basic ${basicCredentials(config.clientId, clientSecret)}`
    } else {
      form.set('client_secret', clientSecret)
    }

    let response
    try {
      response = await deps.createClient(discovery.hosts).post({
        url: discovery.tokenEndpoint,
        headers,
        body: form.toString(),
        contentType: 'application/x-www-form-urlencoded',
      })
    } catch (error) {
      return { ok: false, detail: `the token endpoint could not be reached: ${describe(error)}` }
    }

    if (response.status !== 200) {
      return {
        ok: false,
        detail: `the token endpoint answered ${String(response.status)} (${readErrorCode(response.body)})`,
      }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(response.body)
    } catch {
      return { ok: false, detail: 'the token response is not JSON' }
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, detail: 'the token response is not a JSON object' }
    }
    const idToken = (parsed as Record<string, unknown>)['id_token']
    if (typeof idToken !== 'string' || idToken.length === 0) {
      return { ok: false, detail: 'the token response carries no id_token' }
    }
    return { ok: true, tokens: { idToken } }
  }

  return {
    id: config.id,
    displayName: config.displayName,

    async start(): Promise<StartSignInResult> {
      const loaded = await metadata.get()
      if (!loaded.ok) {
        return { ok: false, reason: 'provider_unavailable', detail: loaded.detail }
      }
      const binding: SignInBinding = {
        state: secret(),
        nonce: secret(),
        codeVerifier: createCodeVerifier(),
      }

      const url = new URL(loaded.metadata.discovery.authorizationEndpoint)
      // A preset's own parameters go on first, so nothing it adds can quietly
      // replace `response_type` or the PKCE challenge below.
      for (const [name, value] of Object.entries(config.authorizationParameters)) {
        url.searchParams.set(name, value)
      }
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', config.clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('scope', config.scopes.join(' '))
      url.searchParams.set('state', binding.state)
      url.searchParams.set('nonce', binding.nonce)
      url.searchParams.set('code_challenge', codeChallenge(binding.codeVerifier))
      url.searchParams.set('code_challenge_method', CODE_CHALLENGE_METHOD)

      return { ok: true, authorizationUrl: url.href, ...binding }
    },

    async complete({ code, nonce, codeVerifier }): Promise<CompleteSignInResult> {
      const loaded = await metadata.get()
      if (!loaded.ok) {
        return { ok: false, reason: 'provider_unavailable', detail: loaded.detail }
      }

      const tokens = await exchange(loaded.metadata.discovery, code, codeVerifier)
      if (!tokens.ok) {
        return { ok: false, reason: 'token_exchange_failed', detail: tokens.detail }
      }

      const verifyWith = (jwks: typeof loaded.metadata.jwks) =>
        verifyIdToken({
          token: tokens.tokens.idToken,
          jwks,
          issuer: config.issuer,
          audience: config.clientId,
          nonce,
          now: clock.now(),
          clockSkewMs,
        })

      let verified = verifyWith(loaded.metadata.jwks)
      if (!verified.ok && verified.reason === 'unknown_key') {
        // The provider has rotated its signing key: read the set again and
        // verify once more. `refreshKeys` will not go back to the provider
        // more often than its own floor allows.
        const refreshed = await metadata.refreshKeys()
        if (!refreshed.ok) {
          return { ok: false, reason: 'provider_unavailable', detail: refreshed.detail }
        }
        verified = verifyWith(refreshed.metadata.jwks)
      }
      if (!verified.ok) {
        return { ok: false, reason: 'invalid_token', detail: verified.detail }
      }
      const { claims } = verified

      // The preset's own checks: Entra's pinned tenant, Google's hosted
      // domain. Data, not branches — a new preset adds rows to this loop.
      for (const check of config.claimChecks) {
        if (claims[check.claim] !== check.expected) {
          return {
            ok: false,
            reason: 'claim_rejected',
            detail: `the ${check.claim} claim is not the configured value`,
          }
        }
      }

      const identity: FederatedIdentity = {
        issuer: config.issuer,
        subject: claims.sub,
        email: readString(claims, config.claims.email),
        emailVerified: readVerified(claims, config.claims.emailVerified),
        displayName: readString(claims, config.claims.displayName),
        groups: readGroups(claims, config.claims.groups),
        claims,
      }
      return { ok: true, identity }
    },
  }
}
