import { describe, expect, it } from 'vitest'
import { createFakeClock } from '@quill/application/test-support'

import {
  createIdentityProviderRegistry,
  oidcCallbackUrl,
  outboundClientFactory,
} from './registry.ts'
import type { OidcProviderConfig } from './provider-config.ts'

const CLOCK = createFakeClock(new Date('2026-01-01T00:00:00.000Z'))

function provider(id: string, displayName: string): OidcProviderConfig {
  return {
    id,
    displayName,
    preset: 'generic',
    issuer: `https://${id}.example.com`,
    clientId: 'client',
    clientSecret: 'secret',
    scopes: ['openid'],
    claims: { email: 'email', emailVerified: 'email_verified', displayName: 'name', groups: null },
    authorizationParameters: {},
    claimChecks: [],
    allowSignUp: true,
    allowLinking: true,
  }
}

function registryOf(...providers: readonly OidcProviderConfig[]) {
  return createIdentityProviderRegistry({
    providers,
    appUrl: 'https://docs.example.com',
    createClient: outboundClientFactory,
    clock: CLOCK,
  })
}

describe('the identity provider registry', () => {
  it('lists providers in configuration order, which is the order the page shows them', () => {
    const registry = registryOf(provider('entra', 'Microsoft'), provider('google', 'Google'))

    expect(
      registry.list().map((entry) => ({ id: entry.id, displayName: entry.displayName })),
    ).toEqual([
      { id: 'entra', displayName: 'Microsoft' },
      { id: 'google', displayName: 'Google' },
    ])
  })

  it('finds one by id, and nothing for an id nobody configured', () => {
    const registry = registryOf(provider('entra', 'Microsoft'))

    expect(registry.find('entra')?.displayName).toBe('Microsoft')
    expect(registry.find('okta')).toBeUndefined()
  })

  it('is empty on an instance with no providers', () => {
    expect(registryOf().list()).toEqual([])
  })

  it('hands each provider its own callback URL', () => {
    expect(oidcCallbackUrl('https://docs.example.com', 'entra')).toBe(
      'https://docs.example.com/api/auth/oidc/entra/callback',
    )
  })

  it('escapes an id in the callback URL rather than trusting it to be a path segment', () => {
    expect(oidcCallbackUrl('https://docs.example.com', 'a/b')).toBe(
      'https://docs.example.com/api/auth/oidc/a%2Fb/callback',
    )
  })
})

describe('outboundClientFactory', () => {
  it('is the SSRF-safe client, bound to the hosts it was given', async () => {
    const client = outboundClientFactory(['sso.example.com'])

    await expect(client.get({ url: 'https://elsewhere.example/' })).rejects.toThrow(
      'not an allowed outbound host',
    )
    await expect(
      client.post({
        url: 'https://elsewhere.example/token',
        body: '',
        contentType: 'application/x-www-form-urlencoded',
      }),
    ).rejects.toThrow('not an allowed outbound host')
  })
})
