import { createFileRoute } from '@tanstack/react-router'

import { VerifyEmailPage } from '../features/auth/verify-email-page.tsx'
import { optionalStringSearch } from './-search.ts'

export const Route = createFileRoute('/verify-email')({
  head: () => ({ meta: [{ title: 'Verify your email' }] }),
  validateSearch: (search: Record<string, unknown>): { token?: string } =>
    optionalStringSearch(search, 'token'),
  component: VerifyEmailPage,
})
