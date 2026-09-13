/**
 * The identity-provider preset registry (ADR-011: "Providers are presets,
 * not modules"; `docs/architecture/patterns.md`, Registry).
 *
 * There is exactly one OIDC implementation. A provider is a **data** object
 * here: the issuer it derives from the fields an administrator fills in, the
 * scopes it wants, where its claims live, the extra authorisation parameters
 * it needs, and the claim checks that must hold for it. Adding Okta, Keycloak,
 * or anything else discovery can describe is adding an entry below and its
 * tests — never a code path in the flow.
 *
 * Nothing here does I/O or holds state, so a preset is checked entirely by
 * reading it, and the whole registry is exercised by a table-driven test.
 */

export type OidcPresetId = 'entra' | 'google-workspace' | 'cognito' | 'auth0' | 'generic'

/** Where a provider puts the things the platform needs, when it is not where the spec puts them. */
export interface OidcClaimMapping {
  readonly email: string
  readonly emailVerified: string
  readonly displayName: string
  /** Null when the preset has no group claim of its own; an administrator may still name one. */
  readonly groups: string | null
}

/**
 * The per-provider fields an administrator supplies. Every one is optional
 * here and required by whichever preset needs it, so one shape describes the
 * whole registry and `deriveIssuer` produces the error message.
 */
export interface OidcPresetFields {
  /** Microsoft Entra ID: the directory (tenant) id the issuer is pinned to. */
  readonly tenantId?: string | undefined
  /** Google Workspace: the `hd` claim every signer-in must carry. */
  readonly hostedDomain?: string | undefined
  /** Amazon Cognito: the AWS region of the user pool. */
  readonly region?: string | undefined
  /** Amazon Cognito: the user pool id, such as `eu-west-2_AbCdEfGhI`. */
  readonly userPoolId?: string | undefined
  /** Auth0: the tenant domain, such as `acme.eu.auth0.com`. */
  readonly domain?: string | undefined
  /** Generic: the issuer, stated outright. */
  readonly issuer?: string | undefined
}

/**
 * A claim that must equal a configured value before the platform will believe
 * the token. Expressed as data so the flow runs the same loop for every
 * provider: Entra's pinned tenant (`tid`) and Google's hosted domain (`hd`)
 * are the two ADR-011 names, and a new preset adds a row rather than a branch.
 */
export interface OidcClaimCheck {
  readonly claim: string
  readonly expected: string
}

export type IssuerResult =
  | { readonly ok: true; readonly issuer: string }
  | { readonly ok: false; readonly message: string }

export interface OidcPreset {
  readonly id: OidcPresetId
  /** The default button label: "Continue with Microsoft". An administrator may override it. */
  readonly displayName: string
  readonly scopes: readonly string[]
  readonly claims: OidcClaimMapping
  /** The issuer, from the fields this preset asks for, or why it cannot be derived. */
  deriveIssuer(fields: OidcPresetFields): IssuerResult
  /** Extra parameters this provider wants on the authorisation request. */
  authorizationParameters(fields: OidcPresetFields): Readonly<Record<string, string>>
  /** Claim equalities that must hold before a token is believed. */
  claimChecks(fields: OidcPresetFields): readonly OidcClaimCheck[]
}

/** The claim names the OpenID Connect core specification itself defines. */
const STANDARD_CLAIMS: OidcClaimMapping = {
  email: 'email',
  emailVerified: 'email_verified',
  displayName: 'name',
  groups: null,
}

const STANDARD_SCOPES: readonly string[] = ['openid', 'email', 'profile']

const NO_PARAMETERS: Readonly<Record<string, string>> = Object.freeze({})

const NO_CHECKS: readonly OidcClaimCheck[] = Object.freeze([])

function missing(variable: string, preset: string): IssuerResult {
  return { ok: false, message: `${variable} is required for the ${preset} preset` }
}

/**
 * Microsoft Entra ID (the directory behind Microsoft 365 and what was Azure
 * AD). The issuer is the **tenant-specific** one and the `tid` claim is
 * pinned to the same tenant: the `common` endpoint would accept a token from
 * any Microsoft directory in the world, including one the attacker created
 * five minutes ago (ADR-011).
 */
const entra: OidcPreset = {
  id: 'entra',
  displayName: 'Microsoft',
  scopes: STANDARD_SCOPES,
  claims: { ...STANDARD_CLAIMS, groups: 'groups' },
  deriveIssuer({ tenantId }) {
    if (tenantId === undefined || tenantId.length === 0) {
      return missing('OIDC_<ID>_TENANT_ID', 'entra')
    }
    return { ok: true, issuer: `https://login.microsoftonline.com/${tenantId}/v2.0` }
  },
  authorizationParameters: () => NO_PARAMETERS,
  claimChecks: ({ tenantId }) =>
    tenantId === undefined ? NO_CHECKS : [{ claim: 'tid', expected: tenantId }],
}

/**
 * Google Workspace. One issuer for the whole of Google, so the restriction
 * that matters is the hosted domain: `hd` is both asked for on the
 * authorisation request (so the account chooser narrows) and *checked* on the
 * token (because a request parameter is a hint, not a control).
 */
const googleWorkspace: OidcPreset = {
  id: 'google-workspace',
  displayName: 'Google',
  scopes: STANDARD_SCOPES,
  claims: STANDARD_CLAIMS,
  deriveIssuer({ hostedDomain }) {
    if (hostedDomain === undefined || hostedDomain.length === 0) {
      return missing('OIDC_<ID>_HOSTED_DOMAIN', 'google-workspace')
    }
    return { ok: true, issuer: 'https://accounts.google.com' }
  },
  authorizationParameters: ({ hostedDomain }) =>
    hostedDomain === undefined ? {} : { hd: hostedDomain },
  claimChecks: ({ hostedDomain }) =>
    hostedDomain === undefined ? NO_CHECKS : [{ claim: 'hd', expected: hostedDomain }],
}

/** Amazon Cognito: one issuer per user pool, per region. */
const cognito: OidcPreset = {
  id: 'cognito',
  displayName: 'Amazon Cognito',
  scopes: STANDARD_SCOPES,
  claims: { ...STANDARD_CLAIMS, groups: 'cognito:groups' },
  deriveIssuer({ region, userPoolId }) {
    if (region === undefined || region.length === 0) {
      return missing('OIDC_<ID>_REGION', 'cognito')
    }
    if (userPoolId === undefined || userPoolId.length === 0) {
      return missing('OIDC_<ID>_USER_POOL_ID', 'cognito')
    }
    return { ok: true, issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}` }
  },
  authorizationParameters: () => NO_PARAMETERS,
  claimChecks: () => NO_CHECKS,
}

/**
 * Auth0. The issuer carries a trailing slash — Auth0 publishes it that way,
 * and an `iss` comparison is an exact string comparison, so dropping it makes
 * every token fail verification.
 */
const auth0: OidcPreset = {
  id: 'auth0',
  displayName: 'Auth0',
  scopes: STANDARD_SCOPES,
  claims: STANDARD_CLAIMS,
  deriveIssuer({ domain }) {
    if (domain === undefined || domain.length === 0) {
      return missing('OIDC_<ID>_DOMAIN', 'auth0')
    }
    return { ok: true, issuer: `https://${domain}/` }
  },
  authorizationParameters: () => NO_PARAMETERS,
  claimChecks: () => NO_CHECKS,
}

/** Anything else discovery can describe: the administrator states the issuer. */
const generic: OidcPreset = {
  id: 'generic',
  displayName: 'single sign-on',
  scopes: STANDARD_SCOPES,
  claims: STANDARD_CLAIMS,
  deriveIssuer({ issuer }) {
    if (issuer === undefined || issuer.length === 0) {
      return missing('OIDC_<ID>_ISSUER', 'generic')
    }
    return { ok: true, issuer }
  },
  authorizationParameters: () => NO_PARAMETERS,
  claimChecks: () => NO_CHECKS,
}

export const OIDC_PRESETS: Readonly<Record<OidcPresetId, OidcPreset>> = Object.freeze({
  entra,
  'google-workspace': googleWorkspace,
  cognito,
  auth0,
  generic,
})

export const OIDC_PRESET_IDS: readonly OidcPresetId[] = Object.keys(OIDC_PRESETS) as OidcPresetId[]

export function findPreset(id: string): OidcPreset | undefined {
  return Object.hasOwn(OIDC_PRESETS, id) ? OIDC_PRESETS[id as OidcPresetId] : undefined
}
