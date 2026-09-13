import { createFileRoute } from '@tanstack/react-router'

import { MagicLinkPage } from '../features/auth/magic-link-page.tsx'
import { optionalStringSearch } from './-search.ts'

export const Route = createFileRoute('/magic-link')({
  head: () => ({ meta: [{ title: 'Sign in' }] }),
  validateSearch: (search: Record<string, unknown>): { token?: string } =>
    optionalStringSearch(search, 'token'),
  component: MagicLinkPage,
})
