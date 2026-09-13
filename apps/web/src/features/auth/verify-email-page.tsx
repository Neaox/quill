import { getRouteApi, Link } from '@tanstack/react-router'

import { Callout, Spinner, buttonClassName } from '@quill/ui'

import { ApiError, useVerifyEmail } from '../../lib/api/index.ts'
import { AuthCard } from './auth-card.tsx'
import { useConsumeOnMount } from './use-consume-on-mount.ts'

const routeApi = getRouteApi('/verify-email')

function ConsumeVerification({ token }: { readonly token: string }) {
  const verify = useVerifyEmail()
  useConsumeOnMount(token, (value) => {
    verify.mutate(value)
  })

  if (verify.isSuccess) {
    return (
      <AuthCard title="Email verified">
        <Callout tone="success">Your email address has been verified.</Callout>
        <Link to="/" className={buttonClassName({ className: 'w-full' })}>
          Continue
        </Link>
      </AuthCard>
    )
  }

  if (verify.isError) {
    return (
      <AuthCard title="This link didn't work">
        <Callout tone="danger">
          {verify.error instanceof ApiError
            ? verify.error.message
            : 'This link is invalid, expired, or already used.'}
        </Callout>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Verifying your email">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner />
        One moment…
      </div>
    </AuthCard>
  )
}

/** The email verification landing page: only meaningful with a `?token=`. */
export function VerifyEmailPage() {
  const { token } = routeApi.useSearch()
  if (token !== undefined) return <ConsumeVerification token={token} />
  return (
    <AuthCard title="Check your email">
      <Callout tone="info">
        We sent you a link to verify your email address. Open it on this device to continue.
      </Callout>
    </AuthCard>
  )
}
