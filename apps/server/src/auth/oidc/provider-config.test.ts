import { describe, expect, it } from 'vitest'

import {
  loadOidcProviders,
  oidcClientSecretName,
  providerVariablePrefix,
} from './provider-config.ts'

/**
 * A misconfigured provider is a server that refuses to start (ADR-011), so
 * every case here is either a complete provider or a specific, readable
 * boot failure.
 */

const ENTRA = {
  OIDC_PROVIDERS: 'entra',
  OIDC_ENTRA_PRESET: 'entra',
  OIDC_ENTRA_TENANT_ID: 'tenant-1',
  OIDC_ENTRA_CLIENT_ID: 'client-1',
  OIDC_ENTRA_CLIENT_SECRET: 'secret-1',
} satisfies NodeJS.ProcessEnv

describe('loadOidcProviders', () => {
  it('is empty when nothing is configured', () => {
    expect(loadOidcProviders({})).toEqual([])
    expect(loadOidcProviders({ OIDC_PROVIDERS: '  ' })).toEqual([])
  })

  it('reads a provider from its preset and its own variables', () => {
    const [provider] = loadOidcProviders(ENTRA)

    expect(provider).toEqual({
      id: 'entra',
      displayName: 'Microsoft',
      preset: 'entra',
      issuer: 'https://login.microsoftonline.com/tenant-1/v2.0',
      clientId: 'client-1',
      clientSecretName: 'oidc/entra/client-secret',
      scopes: ['openid', 'email', 'profile'],
      claims: {
        email: 'email',
        emailVerified: 'email_verified',
        displayName: 'name',
        groups: 'groups',
      },
      authorizationParameters: {},
      claimChecks: [{ claim: 'tid', expected: 'tenant-1' }],
      allowSignUp: true,
      allowLinking: true,
    })
  })

  it('keeps the order they were named in, which is the order the page shows them', () => {
    const providers = loadOidcProviders({
      OIDC_GOOGLE_PRESET: 'google-workspace',
      OIDC_GOOGLE_HOSTED_DOMAIN: 'example.com',
      OIDC_GOOGLE_CLIENT_ID: 'g',
      OIDC_GOOGLE_CLIENT_SECRET: 'gs',
      ...ENTRA,
      OIDC_PROVIDERS: 'google, entra',
    })
    expect(providers.map((provider) => provider.id)).toEqual(['google', 'entra'])
  })

  it('leaves the client secret to the secrets store: OIDC_<ID>_CLIENT_SECRET is not read here at all', () => {
    // Valid at config-load time whether it is set or not, because the
    // secrets store (ADR-034) may hold `oidc/entra/client-secret` instead,
    // and its value — when it is the fallback that is actually used — is
    // read fresh from the environment at the moment of use
    // (`infrastructure/secrets/resolve-secret.ts`), never snapshotted here.
    // Whether *something* names a value is checked once the database is
    // reachable (`infrastructure/secrets/boot-validation.ts`).
    const { OIDC_ENTRA_CLIENT_SECRET: _omitted, ...withoutSecret } = ENTRA
    const [withSecret] = loadOidcProviders(ENTRA)
    const [without] = loadOidcProviders(withoutSecret)

    expect(without).toEqual(withSecret)
    expect(without?.clientSecretName).toBe('oidc/entra/client-secret')
  })

  it('allows a plain http issuer only when told to (OIDC_DEV_LOOPBACK, config.ts)', () => {
    const env = {
      OIDC_PROVIDERS: 'fake',
      OIDC_FAKE_ISSUER: 'http://oidc-fake.e2e.quill.test:3197',
      OIDC_FAKE_CLIENT_ID: 'c',
      OIDC_FAKE_CLIENT_SECRET: 's',
    }

    expect(() => loadOidcProviders(env)).toThrow(/must use https/)
    const [provider] = loadOidcProviders(env, true)
    expect(provider?.issuer).toBe('http://oidc-fake.e2e.quill.test:3197')
  })

  it('computes the secret name from the provider id', () => {
    expect(oidcClientSecretName('entra')).toBe('oidc/entra/client-secret')
    expect(oidcClientSecretName('acme-corp')).toBe('oidc/acme-corp/client-secret')
  })

  it('turns a hyphen in the id into an underscore in the variable names', () => {
    expect(providerVariablePrefix('acme-corp')).toBe('OIDC_ACME_CORP_')
    const [provider] = loadOidcProviders({
      OIDC_PROVIDERS: 'acme-corp',
      OIDC_ACME_CORP_ISSUER: 'https://sso.acme.example',
      OIDC_ACME_CORP_CLIENT_ID: 'c',
      OIDC_ACME_CORP_CLIENT_SECRET: 's',
    })
    expect(provider?.issuer).toBe('https://sso.acme.example')
  })

  it('takes the overrides an administrator may need', () => {
    const [provider] = loadOidcProviders({
      OIDC_PROVIDERS: 'sso',
      OIDC_SSO_ISSUER: 'https://sso.example.com',
      OIDC_SSO_CLIENT_ID: 'c',
      OIDC_SSO_CLIENT_SECRET: 's',
      OIDC_SSO_DISPLAY_NAME: 'Acme',
      OIDC_SSO_SCOPES: 'openid email profile groups',
      OIDC_SSO_EMAIL_CLAIM: 'upn',
      OIDC_SSO_EMAIL_VERIFIED_CLAIM: 'verified',
      OIDC_SSO_NAME_CLAIM: 'display_name',
      OIDC_SSO_GROUPS_CLAIM: 'https://acme.example/groups',
      OIDC_SSO_ALLOW_SIGN_UP: 'false',
      OIDC_SSO_ALLOW_LINKING: 'false',
    })

    expect(provider).toMatchObject({
      displayName: 'Acme',
      scopes: ['openid', 'email', 'profile', 'groups'],
      claims: {
        email: 'upn',
        emailVerified: 'verified',
        displayName: 'display_name',
        groups: 'https://acme.example/groups',
      },
      allowSignUp: false,
      // ADR-011's linking policy: an administrator can refuse to let this
      // provider attach itself to accounts that already exist.
      allowLinking: false,
    })
  })

  it('accepts scopes separated by commas as well as spaces', () => {
    const [provider] = loadOidcProviders({
      OIDC_PROVIDERS: 'sso',
      OIDC_SSO_ISSUER: 'https://sso.example.com',
      OIDC_SSO_CLIENT_ID: 'c',
      OIDC_SSO_CLIENT_SECRET: 's',
      OIDC_SSO_SCOPES: 'openid, email',
    })
    expect(provider?.scopes).toEqual(['openid', 'email'])
  })

  it.each([
    [
      'an unknown preset',
      { ...ENTRA, OIDC_ENTRA_PRESET: 'okta' },
      /OIDC_ENTRA_PRESET must be one of/,
    ],
    [
      'a preset whose field is missing',
      { OIDC_PROVIDERS: 'entra', OIDC_ENTRA_PRESET: 'entra' },
      /OIDC_ENTRA_TENANT_ID is required for the entra preset \("entra"\)/,
    ],
    [
      'no client id',
      { ...ENTRA, OIDC_ENTRA_CLIENT_ID: '' },
      /OIDC_ENTRA_CLIENT_ID is required: "entra" is named in OIDC_PROVIDERS/,
    ],
    [
      'scopes without openid',
      { ...ENTRA, OIDC_ENTRA_SCOPES: 'email profile' },
      /must include "openid"/,
    ],
    [
      'an issuer that is not a URL',
      {
        OIDC_PROVIDERS: 'sso',
        OIDC_SSO_ISSUER: 'not-a-url',
        OIDC_SSO_CLIENT_ID: 'c',
        OIDC_SSO_CLIENT_SECRET: 's',
      },
      /OIDC_SSO_ISSUER must be an absolute URL/,
    ],
    [
      'an issuer over plain http',
      {
        OIDC_PROVIDERS: 'sso',
        OIDC_SSO_ISSUER: 'http://sso.example.com',
        OIDC_SSO_CLIENT_ID: 'c',
        OIDC_SSO_CLIENT_SECRET: 's',
      },
      /must use https/,
    ],
    [
      'an issuer with a query string, which `iss` never has',
      {
        OIDC_PROVIDERS: 'sso',
        OIDC_SSO_ISSUER: 'https://sso.example.com/?tenant=1',
        OIDC_SSO_CLIENT_ID: 'c',
        OIDC_SSO_CLIENT_SECRET: 's',
      },
      /must have no query or fragment/,
    ],
    [
      'an id that is not url-safe',
      { OIDC_PROVIDERS: 'Entra ID' },
      /OIDC_PROVIDERS entries are lower-case/,
    ],
    ['the same id twice', { ...ENTRA, OIDC_PROVIDERS: 'entra,entra' }, /more than once/],
  ])('refuses to boot with %s', (_name, env, message) => {
    expect(() => loadOidcProviders(env as NodeJS.ProcessEnv)).toThrow(message)
  })
})
