import { createFileRoute } from '@tanstack/react-router'

import { SignUpPage } from '../features/auth/sign-up-page.tsx'

export const Route = createFileRoute('/sign-up')({
  head: () => ({ meta: [{ title: 'Create an account' }] }),
  component: SignUpPage,
})
