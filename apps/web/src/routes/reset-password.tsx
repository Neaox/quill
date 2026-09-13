import { createFileRoute } from '@tanstack/react-router'

import { ResetPasswordPage } from '../features/auth/reset-password-page.tsx'
import { optionalStringSearch } from './-search.ts'

export const Route = createFileRoute('/reset-password')({
  head: () => ({ meta: [{ title: 'Choose a new password' }] }),
  validateSearch: (search: Record<string, unknown>): { token?: string } =>
    optionalStringSearch(search, 'token'),
  component: ResetPasswordPage,
})
