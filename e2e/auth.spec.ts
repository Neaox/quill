import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { signInAsAdmin } from './support/admin.ts'
import { createWorkspace, uniqueEmail } from './support/fixtures.ts'

/**
 * Unique per run, because the server checks new passwords against the known
 * breach corpus (ADR-011) and every memorable example phrase is in it. A
 * random one is also what a password manager would actually produce.
 */
const PASSWORD = `e2e-${randomUUID()}`

/**
 * Browser-specific behaviour this spec accounts for:
 *
 * - **It runs at phone width too** (`mobile-safari`), where the signed-in home
 *   still has to say who is signed in. It used to say so only from `sm` up,
 *   because the identity slot is shared with the document shell's 40px bar;
 *   that narrowing is now the shell's alone (`SignedInHeader`'s `compact`), so
 *   this assertion holds at every width rather than at desktop ones.
 */

test.describe('authentication', () => {
  test('signs up, signs in, and signs out', async ({ page, request }) => {
    const email = uniqueEmail('auth')

    await page.goto('/sign-up')
    await page.getByLabel('Name', { exact: false }).fill('E2E Reader')
    await page.getByLabel('Email', { exact: false }).fill(email)
    await page.getByLabel('Password', { exact: false }).fill(PASSWORD)
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Account created' })).toBeVisible()
    await page.getByRole('link', { name: 'Sign in' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
    await page.getByLabel('Email', { exact: false }).fill(email)
    await page.getByLabel('Password', { exact: false }).fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // No `redirect` to preserve: signing in from `/sign-in` goes home.
    await expect(page).toHaveURL('/')

    // A freshly signed-up person holds no grant, so the signed-in home tells
    // them so rather than listing anything (docs/design/home.md), and a
    // workspace the seeded admin creates is refused to them: the permission
    // resolver is real now, and this journey asserts that rather than
    // assuming it away.
    await expect(page.getByText('No workspaces yet')).toBeVisible()
    await expect(page.getByText('E2E Reader')).toBeVisible()

    await signInAsAdmin(request)
    const workspace = await createWorkspace(request, 'Auth Spec Workspace')
    await page.goto(`/w/${workspace.id}`)
    // The refusal itself, not merely the absence of the workspace: a heading
    // is also hidden while the route is still loading, and moving on then
    // lets the in-flight navigation overtake the next `goto` (Firefox
    // `NS_ERROR_FAILURE`, WebKit "interrupted by another navigation").
    await expect(page.getByText("We couldn't find that workspace")).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: workspace.name })).toBeHidden()

    await page.goto('/')
    await page.getByRole('button', { name: 'Sign out' }).click()
    // Signing out empties the `me` cache and the app puts the signed-out
    // person back on sign-in. Waiting for that page is what keeps the
    // navigation below from being cancelled by it — Firefox reports
    // `NS_BINDING_ABORTED` and WebKit "Frame load interrupted" when a
    // client-side navigation overtakes a document load, where Chromium
    // usually gets away with it.
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()

    // Signed out: the workspace redirects to sign-in, with the workspace
    // path preserved as the return path.
    await page.goto(`/w/${workspace.id}`)
    await expect(page).toHaveURL(/\/sign-in\?redirect=/)
  })

  test('shows an error and stays on the page for the wrong password', async ({ page }) => {
    const email = uniqueEmail('wrong-password')
    await page.request.post('/api/auth/sign-up', {
      data: { email, password: PASSWORD, displayName: 'E2E Wrong Password' },
    })

    await page.goto('/sign-in')
    await page.getByLabel('Email', { exact: false }).fill(email)
    await page.getByLabel('Password', { exact: false }).fill('not the right password')
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Scoped to the form: the application shell also mounts the toaster's
    // assertive live region, which is a permanently present empty `alert`.
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'Incorrect email or password',
    )
    await expect(page).toHaveURL('/sign-in')
  })
})
