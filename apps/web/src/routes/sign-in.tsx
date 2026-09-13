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
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    optionalStringSearch(search, 'redirect'),
  component: SignInPage,
})
