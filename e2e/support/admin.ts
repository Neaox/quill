import type { APIRequestContext } from '@playwright/test'

import { BROWSER_HEADERS } from './fixtures.ts'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './seed.ts'

/**
 * Signs the given request context in as the seeded instance admin
 * (`apps/server/src/scripts/seed.ts`, run once by Playwright's
 * `globalSetup` before any test — see `global-setup.ts`).
 *
 * Creating a unit or a workspace needs an instance admin
 * (`docs/architecture/api-contract-m2.md`), and M2 has no bootstrap route
 * for granting that bit, so admin-only setup goes through this seeded
 * account's session instead. Everything else a journey needs — a
 * workspace's documents included — is created through the real API by
 * whichever session (this one, or a signed-up user's) the test is actually
 * exercising.
 */
export async function signInAsAdmin(request: APIRequestContext): Promise<void> {
  const response = await request.post('/api/auth/sign-in', {
    headers: BROWSER_HEADERS,
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })
  if (!response.ok()) {
    throw new Error(`Admin sign-in failed with status ${response.status()}`)
  }
}
