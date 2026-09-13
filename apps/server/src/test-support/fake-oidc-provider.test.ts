import { describe, expect, it } from 'vitest'

import { codeChallenge, createCodeVerifier } from '../auth/oidc/pkce.ts'
import {
  encodeClaimsCookie,
  startFakeOidcProvider,
  CLAIMS_COOKIE_NAME,
} from './fake-oidc-provider.ts'

/**
 * The one path `e2e/sso.spec.ts` drives that no vitest integration test
 * otherwise reaches: a real browser navigating to `/authorize` directly,
 * rather than the in-process `authorize()` helper `auth-oidc.integration.test.ts`
 * calls. Both mint a code the same way (`idTokenFor`), so this file only
 * proves the HTTP surface and the per-request claims cookie
 * (`readClaimsCookie`) — the token exchange itself, the signature check, and
 * everything above it are `auth-oidc.integration.test.ts`'s job.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')

describe('the browser-facing /authorize endpoint', () => {
  it('redirects with a code and the state it was given, on the fixed port it was asked for', async () => {
    const provider = await startFakeOidcProvider({
      clientId: 'client',
      clientSecret: 'secret',
      now: () => NOW,
      port: 0,
    })
    try {
      const url = new URL(`http://127.0.0.1:${new URL(provider.issuer).port}/authorize`)
      url.searchParams.set('code_challenge', 'a-challenge')
      url.searchParams.set('redirect_uri', 'https://app.example/callback')
      url.searchParams.set('nonce', 'a-nonce')
      url.searchParams.set('state', 'a-state')

      const reply = await fetch(url, { redirect: 'manual' })

      expect(reply.status).toBe(302)
      const location = new URL(reply.headers.get('location') ?? '')
      expect(location.origin + location.pathname).toBe('https://app.example/callback')
      expect(location.searchParams.get('state')).toBe('a-state')
      expect(location.searchParams.get('code')).toMatch(/^code-\d+$/)
    } finally {
      await provider.close()
    }
  })

  it('asserts the claims a claims cookie carries, per request, not the shared nextToken state', async () => {
    const provider = await startFakeOidcProvider({
      clientId: 'client',
      clientSecret: 'secret',
      now: () => NOW,
    })
    try {
      const cookieValue = encodeClaimsCookie({ email: 'from-the-cookie@example.com' })
      const verifier = createCodeVerifier()
      const authorize = new URL(`http://127.0.0.1:${new URL(provider.issuer).port}/authorize`)
      authorize.searchParams.set('code_challenge', codeChallenge(verifier))
      authorize.searchParams.set('redirect_uri', 'https://app.example/callback')
      authorize.searchParams.set('nonce', 'a-nonce')
      authorize.searchParams.set('state', 'a-state')

      const authorized = await fetch(authorize, {
        redirect: 'manual',
        headers: { cookie: `${CLAIMS_COOKIE_NAME}=${cookieValue}; other=1` },
      })
      const code = new URL(authorized.headers.get('location') ?? '').searchParams.get('code') ?? ''

      // The token endpoint stays on the fake issuer hostname (server-only,
      // never fetched by a real browser), reached the way the platform's own
      // outbound client would: `provider.createClient` is what pins DNS to
      // loopback for it (`fake-oidc-provider.ts`'s doc comment) — plain
      // `fetch` cannot resolve `sso.provider.test` at all.
      const tokenResponse = await provider.createClient([provider.host]).post({
        url: `${provider.issuer}/token`,
        headers: {
          authorization: `Basic ${Buffer.from('client:secret', 'utf8').toString('base64')}`,
        },
        contentType: 'application/x-www-form-urlencoded',
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: 'https://app.example/callback',
          code_verifier: verifier,
        }).toString(),
      })
      const body = JSON.parse(tokenResponse.body) as { id_token: string }
      const [, payload = ''] = body.id_token.split('.')
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        email: string
      }

      expect(claims.email).toBe('from-the-cookie@example.com')

      // A second attempt with no cookie at all falls back to the shared
      // default rather than reusing the first request's claims.
      const secondAuthorize = new URL(authorize.href)
      const secondReply = await fetch(secondAuthorize, { redirect: 'manual' })
      expect(secondReply.status).toBe(302)
    } finally {
      await provider.close()
    }
  })

  it('falls back to the shared default when a cookie header carries other cookies but not this one', async () => {
    const provider = await startFakeOidcProvider({
      clientId: 'client',
      clientSecret: 'secret',
      now: () => NOW,
    })
    try {
      const authorize = new URL(`http://127.0.0.1:${new URL(provider.issuer).port}/authorize`)
      authorize.searchParams.set('code_challenge', 'a-challenge')
      authorize.searchParams.set('redirect_uri', 'https://app.example/callback')
      authorize.searchParams.set('nonce', 'a-nonce')
      authorize.searchParams.set('state', 'a-state')

      const reply = await fetch(authorize, {
        redirect: 'manual',
        headers: { cookie: 'other=1; and-another' },
      })

      expect(reply.status).toBe(302)
    } finally {
      await provider.close()
    }
  })

  it('ignores an unparseable claims cookie rather than failing the request', async () => {
    const provider = await startFakeOidcProvider({
      clientId: 'client',
      clientSecret: 'secret',
      now: () => NOW,
    })
    try {
      const authorize = new URL(`http://127.0.0.1:${new URL(provider.issuer).port}/authorize`)
      authorize.searchParams.set('code_challenge', 'a-challenge')
      authorize.searchParams.set('redirect_uri', 'https://app.example/callback')
      authorize.searchParams.set('nonce', 'a-nonce')
      authorize.searchParams.set('state', 'a-state')

      const reply = await fetch(authorize, {
        redirect: 'manual',
        headers: { cookie: `${CLAIMS_COOKIE_NAME}=not-valid-base64url-json` },
      })

      expect(reply.status).toBe(302)
    } finally {
      await provider.close()
    }
  })
})
