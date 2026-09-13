import { randomUUID } from 'node:crypto'

import type { BrowserContext } from '@playwright/test'

import { e2eFakeOidcPort } from './env.ts'

/**
 * The fake OpenID Connect provider `e2e/sso.spec.ts` drives — a real process,
 * `apps/server/src/scripts/fake-oidc-server-cli.ts` wrapping
 * `test-support/fake-oidc-provider.ts` — and the browser-reachable origin
 * its `/authorize` endpoint answers on (`fake-oidc-provider.ts`'s doc
 * comment: a real browser gets a literal `127.0.0.1` address, never the
 * fake hostname only the API server's loopback-aware outbound client can
 * resolve).
 */
export function fakeOidcOrigin(): string {
  return `http://127.0.0.1:${String(e2eFakeOidcPort())}`
}

/**
 * The exact cookie encoding `fake-oidc-provider.ts`'s `readClaimsCookie`
 * decodes (that module exports the matching `encodeClaimsCookie`, and its
 * own tests prove the two agree). Restated here, at one line, rather than
 * imported: `e2e/**` hits the real HTTP API and imports no server code
 * (`e2e/support/seed.ts`'s doc comment) — this spec talks to the fake
 * provider as the standalone process it is, not as a module.
 */
const CLAIMS_COOKIE_NAME = 'quill_e2e_claims'

export interface FakeIdentity {
  readonly subject: string
  readonly email: string
  readonly name: string
  readonly emailVerified?: boolean
}

/** A subject and an email nothing else in a concurrent run could produce. */
export function uniqueFakeIdentity(prefix: string): FakeIdentity {
  const unique = randomUUID().slice(0, 8)
  return {
    subject: `${prefix}-subject-${unique}`,
    email: `${prefix}-${unique}@example.com`,
    name: `E2E ${prefix}`,
  }
}

/**
 * Sets the claims the fake provider will assert on the *next* authorization
 * it completes for this browser context — a cookie on the provider's own
 * origin, read by its `/authorize` handler, so two browser contexts driving
 * the one shared fake-provider process (this spec's four profiles, each
 * running every test) never share, and never race on, a single mutable
 * "next token": each context's cookie jar is its own.
 *
 * Must be called before the browser ever navigates to "Continue with Fake
 * SSO" — setting a cookie on an origin the browser has not opened does not
 * require opening it first, which is exactly what makes this safe to call
 * from Node before the click that starts the real navigation.
 */
export async function setFakeIdentity(
  context: BrowserContext,
  identity: FakeIdentity,
): Promise<void> {
  const origin = new URL(fakeOidcOrigin())
  const value = Buffer.from(
    JSON.stringify({
      subject: identity.subject,
      email: identity.email,
      name: identity.name,
      emailVerified: identity.emailVerified ?? true,
    }),
    'utf8',
  ).toString('base64url')
  await context.addCookies([
    { name: CLAIMS_COOKIE_NAME, value, domain: origin.hostname, path: '/' },
  ])
}
