import { getRouteApi, Link } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import { Button, Callout, Input, textLinkClassName } from '@quill/ui'

import { useConfirmPasswordReset, useRequestPasswordReset } from '../../lib/api/index.ts'
import { AuthCard } from './auth-card.tsx'
import { FormError } from '../../lib/forms/form-error.tsx'

const routeApi = getRouteApi('/reset-password')
const MIN_PASSWORD_LENGTH = 8

function ConfirmReset({ token }: { readonly token: string }) {
  const confirmReset = useConfirmPasswordReset()
  const [newPassword, setNewPassword] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (newPassword.length < MIN_PASSWORD_LENGTH) return
    confirmReset.mutate({ token, newPassword })
  }

  if (confirmReset.isSuccess) {
    return (
      <AuthCard title="Password updated">
        <Callout tone="success">Your password has been changed.</Callout>
        <Link to="/sign-in" className={textLinkClassName({ size: 'sm' })}>
          Sign in
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input
          label="New password"
          type="password"
          name="new-password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          description="At least 8 characters."
          value={newPassword}
          onChange={(event) => {
            setNewPassword(event.target.value)
          }}
        />
        <FormError error={confirmReset.error} />
        <Button type="submit" loading={confirmReset.isPending} className="w-full">
          Update password
        </Button>
      </form>
    </AuthCard>
  )
}

function RequestReset() {
  const requestReset = useRequestPasswordReset()
  const [email, setEmail] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    requestReset.mutate(email)
  }

  if (requestReset.isSuccess) {
    return (
      <AuthCard title="Check your email">
        <Callout tone="success">
          If an account exists for {email}, a password reset link is on its way.
        </Callout>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Reset your password"
      footer={
        <Link to="/sign-in" className={textLinkClassName()}>
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
          }}
        />
        <FormError error={requestReset.error} />
        <Button type="submit" loading={requestReset.isPending} className="w-full">
          Send reset link
        </Button>
      </form>
    </AuthCard>
  )
}

/** Request a reset link (no `token`) or set a new password with one (`?token=`). */
export function ResetPasswordPage() {
  const { token } = routeApi.useSearch()
  if (token !== undefined) return <ConfirmReset token={token} />
  return <RequestReset />
}
