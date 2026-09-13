import { findPreset, OIDC_PRESET_IDS } from './presets.ts'
import type { OidcClaimCheck, OidcClaimMapping, OidcPresetFields, OidcPresetId } from './presets.ts'

/**
 * One configured identity provider, read from the environment and validated
 * before the server listens (ADR-011: "Configuration lives per organisation,
 * entered by an instance administrator … Nothing about a provider is
 * hard-coded beyond its preset").
 *
 * A provider that does not make sense is a boot failure, not a sign-in
 * failure. A missing tenant id or an issuer that is not https would otherwise
 * show up as a broken button on the sign-in page of a running instance, at
 * the worst possible moment for the person pressing it.
 *
 * Environment variables are `OIDC_PROVIDERS=entra,google` plus, for each id,
 * `OIDC_<ID>_…` with the id upper-cased and its hyphens turned into
 * underscores. The full table is in `.env.example` and
 * `apps/server/README.md`.
 */

export interface OidcProviderConfig {
  /** The id in `OIDC_PROVIDERS`: what the routes name and what an identity row records. */
  readonly id: string
  /** What the sign-in button says after "Continue with". */
  readonly displayName: string
  readonly preset: OidcPresetId
  /** Derived from the preset's fields, or stated outright for `generic`. */
  readonly issuer: string
  readonly clientId: string
  /**
   * TODO(M3): this must become a secret *name* written with `setSecret` and
   * read with `getSecret` from the settings store's secrets API — the
   * envelope-encrypted rows under the instance master key a `KeyProvider`
   * holds (ADR-011: "client secret stored encrypted with the instance key";
   * ADR-034) — so the value never sits in the process environment where a
   * crash dump or a `/proc/<pid>/environ` read can reach it. That API now
   * exists; moving to it is a migration of its own (an administrator must
   * enter each secret once before the environment variable stops being read),
   * so this branch still reads `OIDC_<ID>_CLIENT_SECRET` verbatim, which is
   * at least "from the environment, never from the repository" as the ADR's
   * supply-chain rule requires. Changing it is changing this field's type and
   * one line in `loadOidcProviders`.
   */
  readonly clientSecret: string
  readonly scopes: readonly string[]
  readonly claims: OidcClaimMapping
  /** Extra parameters the preset puts on the authorisation request, such as Google's `hd`. */
  readonly authorizationParameters: Readonly<Record<string, string>>
  /** Claim equalities that must hold: Entra's pinned `tid`, Google's `hd`. */
  readonly claimChecks: readonly OidcClaimCheck[]
  /**
   * Whether a person this provider vouches for, who has no account here, gets
   * one made for them. Default true; an instance that provisions its people
   * another way sets it false and gets a refusal instead of a new account.
   */
  readonly allowSignUp: boolean
  /**
   * Whether an identity may be attached to an account that already exists
   * here (ADR-011's linking policy). Default true.
   *
   * Linking is the step with the most to lose, so it is the one an
   * administrator can turn off: with it false, this provider can only sign in
   * an identity it has already been linked to, or provision a new account.
   * Even with it true, linking requires the local account to have verified
   * that address for itself — see `federated-sign-in-service.ts`.
   */
  readonly allowLinking: boolean
}

/** Lower-case, url-safe, and short enough to read in a path segment. */
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,31}$/

export function providerVariablePrefix(id: string): string {
  return `OIDC_${id.toUpperCase().replaceAll('-', '_')}_`
}

function required(env: NodeJS.ProcessEnv, variable: string, id: string): string {
  const value = env[variable]
  if (value === undefined || value.length === 0) {
    throw new Error(`${variable} is required: "${id}" is named in OIDC_PROVIDERS`)
  }
  return value
}

function optional(env: NodeJS.ProcessEnv, variable: string): string | undefined {
  const value = env[variable]
  return value === undefined || value.length === 0 ? undefined : value
}

/** Scopes are space-separated, as they are on the wire; commas are accepted too. */
function parseScopes(raw: string | undefined, fallback: readonly string[]): readonly string[] {
  if (raw === undefined) return fallback
  const scopes = raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0)
  if (!scopes.includes('openid')) {
    throw new Error('OIDC scopes must include "openid"; that is what makes it OpenID Connect')
  }
  return scopes
}

/**
 * The issuer has to be exactly what the provider will put in `iss`, because
 * that comparison is a string comparison. A query or a fragment is never part
 * of one, and https is not negotiable for a document that carries signing
 * keys.
 */
function checkIssuer(issuer: string, prefix: string): string {
  let url: URL
  try {
    url = new URL(issuer)
  } catch {
    throw new Error(`${prefix}ISSUER must be an absolute URL, received "${issuer}"`)
  }
  if (url.protocol !== 'https:') {
    throw new Error(
      `The issuer for ${prefix.slice(0, -1)} must use https, received "${issuer}" (ADR-011)`,
    )
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error(`The issuer for ${prefix.slice(0, -1)} must have no query or fragment`)
  }
  return issuer
}

function loadProvider(env: NodeJS.ProcessEnv, id: string): OidcProviderConfig {
  const prefix = providerVariablePrefix(id)
  const presetId = env[`${prefix}PRESET`] ?? 'generic'
  const preset = findPreset(presetId)
  if (preset === undefined) {
    throw new Error(
      `${prefix}PRESET must be one of ${OIDC_PRESET_IDS.join(', ')}, received "${presetId}"`,
    )
  }

  const fields: OidcPresetFields = {
    tenantId: optional(env, `${prefix}TENANT_ID`),
    hostedDomain: optional(env, `${prefix}HOSTED_DOMAIN`),
    region: optional(env, `${prefix}REGION`),
    userPoolId: optional(env, `${prefix}USER_POOL_ID`),
    domain: optional(env, `${prefix}DOMAIN`),
    issuer: optional(env, `${prefix}ISSUER`),
  }
  const derived = preset.deriveIssuer(fields)
  if (!derived.ok) {
    throw new Error(`${derived.message.replaceAll('OIDC_<ID>_', prefix)} ("${id}")`)
  }

  const groups = optional(env, `${prefix}GROUPS_CLAIM`) ?? preset.claims.groups
  return {
    id,
    displayName: optional(env, `${prefix}DISPLAY_NAME`) ?? preset.displayName,
    preset: preset.id,
    issuer: checkIssuer(derived.issuer, prefix),
    clientId: required(env, `${prefix}CLIENT_ID`, id),
    clientSecret: required(env, `${prefix}CLIENT_SECRET`, id),
    scopes: parseScopes(optional(env, `${prefix}SCOPES`), preset.scopes),
    claims: {
      email: optional(env, `${prefix}EMAIL_CLAIM`) ?? preset.claims.email,
      emailVerified: optional(env, `${prefix}EMAIL_VERIFIED_CLAIM`) ?? preset.claims.emailVerified,
      displayName: optional(env, `${prefix}NAME_CLAIM`) ?? preset.claims.displayName,
      groups,
    },
    authorizationParameters: preset.authorizationParameters(fields),
    claimChecks: preset.claimChecks(fields),
    allowSignUp: env[`${prefix}ALLOW_SIGN_UP`] !== 'false',
    allowLinking: env[`${prefix}ALLOW_LINKING`] !== 'false',
  }
}

/**
 * Every provider named in `OIDC_PROVIDERS`, in the order they are named,
 * which is the order the sign-in page shows them in.
 */
export function loadOidcProviders(env: NodeJS.ProcessEnv): readonly OidcProviderConfig[] {
  const raw = env['OIDC_PROVIDERS']
  if (raw === undefined || raw.trim().length === 0) return []

  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)

  const seen = new Set<string>()
  return ids.map((id) => {
    if (!PROVIDER_ID.test(id)) {
      throw new Error(
        `OIDC_PROVIDERS entries are lower-case, may contain digits and hyphens, and are at most ` +
          `32 characters; received "${id}"`,
      )
    }
    if (seen.has(id)) {
      throw new Error(`OIDC_PROVIDERS names "${id}" more than once`)
    }
    seen.add(id)
    return loadProvider(env, id)
  })
}
