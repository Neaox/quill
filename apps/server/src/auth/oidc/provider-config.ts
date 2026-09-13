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
   * The *name* of the secret holding this provider's client secret — never
   * the value (ADR-034: "Settings files reference secrets by name, never by
   * value"). Resolved through `getSecret` at the moment of use, the token
   * exchange, so the value never sits in `OidcProviderConfig` where a crash
   * dump or a log of this object would reach it — this holds for the entire
   * deprecation window, because `OIDC_<ID>_CLIENT_SECRET`'s value is read
   * fresh from the environment at that same moment
   * (`infrastructure/secrets/resolve-secret.ts`) rather than snapshotted here.
   *
   * Always `oidc/<id>/client-secret` (`oidcClientSecretName`): a provider's
   * secret name is derived from its id rather than administrator-chosen, so
   * there is exactly one place an administrator writes it —
   * `pnpm --filter @quill/server secrets:set oidc/<id>/client-secret` — and
   * boot validation knows what to look for without reading the environment a
   * second time.
   */
  readonly clientSecretName: string
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

/**
 * The secret name a provider's client secret is always stored under
 * (ADR-034). Derived from the id rather than administrator-chosen, so there
 * is exactly one name to write it under and one name boot validation checks.
 */
export function oidcClientSecretName(id: string): string {
  return `oidc/${id}/client-secret`
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
 * keys — except under `OIDC_DEV_LOOPBACK` (`config.ts`), which this instance
 * only ever set once it has already refused to run anywhere but loopback:
 * `e2e/sso.spec.ts`'s in-process fake provider serves plain http, the same
 * reason the vitest harness bypasses this whole module (`test-support/harness.ts`'s
 * doc comment) rather than being asked to serve https to itself.
 */
function checkIssuer(issuer: string, prefix: string, allowInsecureIssuer: boolean): string {
  let url: URL
  try {
    url = new URL(issuer)
  } catch {
    throw new Error(`${prefix}ISSUER must be an absolute URL, received "${issuer}"`)
  }
  if (url.protocol !== 'https:' && !(allowInsecureIssuer && url.protocol === 'http:')) {
    throw new Error(
      `The issuer for ${prefix.slice(0, -1)} must use https, received "${issuer}" (ADR-011)`,
    )
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error(`The issuer for ${prefix.slice(0, -1)} must have no query or fragment`)
  }
  return issuer
}

function loadProvider(
  env: NodeJS.ProcessEnv,
  id: string,
  allowInsecureIssuer: boolean,
): OidcProviderConfig {
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
    issuer: checkIssuer(derived.issuer, prefix, allowInsecureIssuer),
    clientId: required(env, `${prefix}CLIENT_ID`, id),
    // Not read here at all any more: the secrets store is the primary source
    // (ADR-034), `OIDC_<ID>_CLIENT_SECRET`'s value is read fresh from the
    // environment at the moment of use (`resolve-secret.ts`), and whether
    // *some* source names a value is checked once the database is reachable,
    // in `infrastructure/secrets/boot-validation.ts`, which is also where the
    // deprecation warning for using this variable is issued.
    clientSecretName: oidcClientSecretName(id),
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
 *
 * `allowInsecureIssuer` is `config.ts`'s `OIDC_DEV_LOOPBACK`, threaded down
 * to `checkIssuer` rather than read from the environment a second time here
 * — `config.ts` is where it is validated against `APP_URL`, once.
 */
export function loadOidcProviders(
  env: NodeJS.ProcessEnv,
  allowInsecureIssuer = false,
): readonly OidcProviderConfig[] {
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
    return loadProvider(env, id, allowInsecureIssuer)
  })
}
