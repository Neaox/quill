import { describe, expect, it } from 'vitest'

import { findPreset, OIDC_PRESETS, OIDC_PRESET_IDS } from './presets.ts'
import type { OidcPresetFields, OidcPresetId } from './presets.ts'

/**
 * The preset registry is data, so its test is a table (ADR-011: adding a
 * provider is adding a preset and its tests).
 */

const FIELDS: Readonly<Record<OidcPresetId, OidcPresetFields>> = {
  entra: { tenantId: '11111111-2222-3333-4444-555555555555' },
  'google-workspace': { hostedDomain: 'example.com' },
  cognito: { region: 'eu-west-2', userPoolId: 'eu-west-2_AbCdEfGhI' },
  auth0: { domain: 'acme.eu.auth0.com' },
  generic: { issuer: 'https://sso.example.com' },
}

const EXPECTED_ISSUER: Readonly<Record<OidcPresetId, string>> = {
  entra: 'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0',
  'google-workspace': 'https://accounts.google.com',
  cognito: 'https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_AbCdEfGhI',
  // Auth0 publishes its issuer with the trailing slash, and `iss` is compared
  // as a string, so dropping it would fail every token.
  auth0: 'https://acme.eu.auth0.com/',
  generic: 'https://sso.example.com',
}

describe('the preset registry', () => {
  it('has the five providers ADR-011 names', () => {
    expect(OIDC_PRESET_IDS).toEqual(['entra', 'google-workspace', 'cognito', 'auth0', 'generic'])
  })

  it.each(OIDC_PRESET_IDS)('derives the issuer for %s', (id) => {
    const derived = OIDC_PRESETS[id].deriveIssuer(FIELDS[id])
    expect(derived).toEqual({ ok: true, issuer: EXPECTED_ISSUER[id] })
  })

  it.each(OIDC_PRESET_IDS)('says which variable %s is missing', (id) => {
    const derived = OIDC_PRESETS[id].deriveIssuer({})
    expect(derived.ok).toBe(false)
    expect(derived.ok ? '' : derived.message).toMatch(/^OIDC_<ID>_[A-Z_]+ is required/)
  })

  it('refuses a Cognito pool without its region', () => {
    expect(OIDC_PRESETS.cognito.deriveIssuer({ userPoolId: 'eu-west-2_x' })).toEqual({
      ok: false,
      message: 'OIDC_<ID>_REGION is required for the cognito preset',
    })
  })

  it('refuses a Cognito region without its pool', () => {
    expect(OIDC_PRESETS.cognito.deriveIssuer({ region: 'eu-west-2' })).toEqual({
      ok: false,
      message: 'OIDC_<ID>_USER_POOL_ID is required for the cognito preset',
    })
  })

  it('treats an empty value as absent, so a blank variable is a boot failure', () => {
    expect(OIDC_PRESETS.entra.deriveIssuer({ tenantId: '' }).ok).toBe(false)
  })

  it('pins the Entra tenant with a claim check, never just with the issuer', () => {
    expect(OIDC_PRESETS.entra.claimChecks(FIELDS.entra)).toEqual([
      { claim: 'tid', expected: '11111111-2222-3333-4444-555555555555' },
    ])
  })

  it('asks Google for a hosted domain and then checks the claim it answers with', () => {
    expect(
      OIDC_PRESETS['google-workspace'].authorizationParameters(FIELDS['google-workspace']),
    ).toEqual({
      hd: 'example.com',
    })
    expect(OIDC_PRESETS['google-workspace'].claimChecks(FIELDS['google-workspace'])).toEqual([
      { claim: 'hd', expected: 'example.com' },
    ])
  })

  it('checks nothing extra, and asks for nothing extra, where a preset has no quirk', () => {
    for (const id of ['cognito', 'auth0', 'generic'] as const) {
      expect(OIDC_PRESETS[id].claimChecks(FIELDS[id])).toEqual([])
      expect(OIDC_PRESETS[id].authorizationParameters(FIELDS[id])).toEqual({})
    }
    expect(OIDC_PRESETS.entra.authorizationParameters(FIELDS.entra)).toEqual({})
  })

  it('has no claim check and no parameter when the field it would use is absent', () => {
    expect(OIDC_PRESETS.entra.claimChecks({})).toEqual([])
    expect(OIDC_PRESETS['google-workspace'].claimChecks({})).toEqual([])
    expect(OIDC_PRESETS['google-workspace'].authorizationParameters({})).toEqual({})
  })

  it('knows where each provider keeps its groups', () => {
    expect(OIDC_PRESETS.entra.claims.groups).toBe('groups')
    expect(OIDC_PRESETS.cognito.claims.groups).toBe('cognito:groups')
    // Google publishes groups through the Directory API, not in the token,
    // and Auth0's claim is namespaced per tenant, so both are configured.
    expect(OIDC_PRESETS['google-workspace'].claims.groups).toBeNull()
    expect(OIDC_PRESETS.auth0.claims.groups).toBeNull()
  })

  it('finds a preset by id, and nothing by an id nobody registered', () => {
    expect(findPreset('entra')).toBe(OIDC_PRESETS.entra)
    expect(findPreset('okta')).toBeUndefined()
    // Not a property of the prototype either: `findPreset('toString')` must
    // not hand back `Object.prototype.toString`.
    expect(findPreset('toString')).toBeUndefined()
  })
})
