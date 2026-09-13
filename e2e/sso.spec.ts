import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { setFakeIdentity, uniqueFakeIdentity } from './support/oidc.ts'
import { uniqueEmail } from './support/fixtures.ts'

/**
 * Single sign-on, through a real browser, against the in-process fake
 * OpenID Connect provider `routes/auth-oidc.integration.test.ts` also
 * drives — the browser journey use case 38 names as still to follow
 * (`docs/product/use-cases.md`).
 *
 * The provider runs as its own process
 * (`apps/server/src/scripts/fake-oidc-server-cli.ts`, started by
 * `playwright.config.ts`'s `webServer` array), configured with a `generic`
 * preset through `OIDC_PROVIDERS=fake`/`OIDC_FAKE_*`
 * (`e2e/support/env.ts`'s `apiServerEnv`). The API server reaches it despite
 * it sitting on loopback only because `OIDC_DEV_LOOPBACK=true`
 * (`apps/server/src/auth/oidc/dev-loopback-client.ts`) — a real browser needs
 * no such thing, since the provider hands out a literal `127.0.0.1`
 * authorization endpoint (`fake-oidc-provider.ts`'s doc comment).
 *
 * Each test sets its own claims on the provider's own origin before
 * clicking "Continue with Fake SSO" (`support/oidc.ts`'s `setFakeIdentity`),
 * with a subject and an email nothing else in a concurrent run could
 * produce — this file's four profiles all drive the one shared provider
 * process, and this is what keeps them from racing on it.
 *
 * **Running just this spec on its own ports**, distinct from `pnpm test:e2e`'s
 * own run (`e2e/support/env.ts`'s defaults, :3100/:5174) — for a second run
 * beside one already in progress, say:
 *
 * ```bash
 * E2E_API_PORT=3196 E2E_WEB_PORT=5196 E2E_FAKE_OIDC_PORT=3197 \
 *   pnpm exec playwright test e2e/sso.spec.ts
 * ```
 *
 * Playwright's `webServer` entries start the API on :3196 against its own
 * `quill_e2e` database (emptied first by `db:reset`), Vite on :5196 (its
 * proxy pointed at :3196), and the fake provider on :3197 —
 * `reuseExistingServer` (true outside CI) means starting them by hand first
 * with the same environment works exactly the same way.
 */

const PASSWORD = `e2e-${randomUUID()}`

test.describe('single sign-on', () => {
  test('shows "Continue with Fake SSO", and completing it signs a new person in', async ({
    page,
    context,
  }) => {
    const identity = uniqueFakeIdentity('sso-first')

    await page.goto('/sign-in')
    const provider = page.getByRole('link', { name: 'Continue with Fake SSO' })
    await expect(provider).toBeVisible()

    await setFakeIdentity(context, identity)
    await provider.click()

    // The provider's own page is never rendered — its `/authorize` answers
    // with an immediate redirect (`fake-oidc-provider.ts`) — so the only
    // browser-visible effect of "the provider signs the person in" is
    // landing back here, signed in.
    await expect(page).toHaveURL('/')
    await expect(page.getByText(identity.name)).toBeVisible()

    const me = await page.request.get('/api/me')
    expect(await me.json()).toMatchObject({
      email: identity.email,
      displayName: identity.name,
      emailVerified: true,
    })

    // The session survives a reload rather than only the redirect's own state.
    await page.reload()
    await expect(page.getByText(identity.name)).toBeVisible()
  })

  test('a second sign-in matches the same person by subject, not by the email they now use', async ({
    page,
    context,
  }) => {
    const subject = uniqueFakeIdentity('sso-subject').subject
    const firstEmail = uniqueEmail('sso-subject-first')
    const secondEmail = uniqueEmail('sso-subject-second')

    await page.goto('/sign-in')
    await setFakeIdentity(context, { subject, email: firstEmail, name: 'First Address' })
    await page.getByRole('link', { name: 'Continue with Fake SSO' }).click()
    await expect(page).toHaveURL('/')
    expect(await (await page.request.get('/api/me')).json()).toMatchObject({ email: firstEmail })

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()

    // The same person, the provider now says, but at a different address —
    // matched by `(issuer, subject)`, not by email (ADR-011).
    await setFakeIdentity(context, { subject, email: secondEmail, name: 'Second Address' })
    await page.getByRole('link', { name: 'Continue with Fake SSO' }).click()

    await expect(page).toHaveURL('/')
    expect(await (await page.request.get('/api/me')).json()).toMatchObject({ email: firstEmail })
  })

  test('refuses an unverified local account with the same email, the same way every other SSO failure is refused', async ({
    page,
    context,
  }) => {
    const email = uniqueEmail('sso-unverified')
    const signUp = await page.request.post('/api/auth/sign-up', {
      data: { email, password: PASSWORD, displayName: 'Squatter' },
    })
    expect(signUp.ok()).toBe(true)
    // No verification link is ever followed: this account has proved nothing
    // about the address, which is exactly the pre-registration attack
    // ADR-011's linking policy exists to close.

    await page.goto('/sign-in')
    // Same email as the local account, but a provider vouching for somebody
    // else entirely at that address — the pre-registration attack, from the
    // other side.
    await setFakeIdentity(context, {
      subject: uniqueFakeIdentity('sso-unverified-real-owner').subject,
      email,
      name: 'Real Owner',
    })
    await page.getByRole('link', { name: 'Continue with Fake SSO' }).click()

    // Every SSO failure looks the same from the browser (ADR-011): the same
    // redirect, the same alert, no session — never "an account with this
    // email already exists".
    await expect(page).toHaveURL(/\/sign-in\?error=sso/)
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'That sign-in could not be completed. Please try again, or sign in with your email.',
    )
    expect((await page.request.get('/api/me')).status()).toBe(401)
  })
})
