import { expect, test } from '@playwright/test'

import { BRAND } from '@quill/brand'

test('the application loads, names itself, and titles the page it landed on', async ({ page }) => {
  // Signed out, the home route sends the visitor to sign in, and every route
  // titles its own page through the router's head management — so the title
  // here is that page's, not the product's, and the product's name is on it.
  await page.goto('/')
  await expect(page).toHaveURL(/sign-in/)
  await expect(page).toHaveTitle('Sign in')
  await expect(page.getByText(BRAND.name).first()).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
})
