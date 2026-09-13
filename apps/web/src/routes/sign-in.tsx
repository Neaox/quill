import { createFileRoute } from '@tanstack/react-router'

import { SignInPage } from '../features/auth/sign-in-page.tsx'
import { optionalStringSearch } from './-search.ts'

/**
 * Where a person gets a session. Not inside `_authenticated`, which exists to
 * send people here.
 *
 * The page they were asking for is a search param, never component state
 * (ADR-013): it survives a refresh, a second tab, and the round trip through
 * an email link.
 */
export const Route = createFileRoute('/sign-in')({
  head: () => ({ meta: [{ title: 'Sign in' }] }),
  /**
   * `redirect` is the page that was being asked for; `error` is how a failed
   * single sign-on comes back from `/api/auth/oidc/:id/callback` (ADR-011).
   */
  validateSearch: (search: Record<string, unknown>): { redirect?: string; error?: string } => ({
    ...optionalStringSearch(search, 'redirect'),
    ...optionalStringSearch(search, 'error'),
  }),
  component: SignInPage,
})
