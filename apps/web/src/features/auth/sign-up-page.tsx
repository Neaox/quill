import { Link } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import { Button, buttonClassName, Callout, Input, textLinkClassName } from '@quill/ui'

import { useSignUp } from '../../lib/api/index.ts'
import { AuthCard } from './auth-card.tsx'
import { FormError } from '../../lib/forms/form-error.tsx'

const MIN_PASSWORD_LENGTH = 8

/**
 * Account creation. Sign-up does not sign the user in on its own
 * (`apps/server/src/application/auth-service.ts`'s `signUp` never sets a
 * session cookie), so success replaces the form with a link to sign in
 * rather than navigating there automatically.
 */
export function SignUpPage() {
  const signUp = useSignUp()

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordTouched, setPasswordTouched] = useState(false)

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordTouched(true)
    if (password.length < MIN_PASSWORD_LENGTH) return
    signUp.mutate({ email, password, displayName })
  }

  if (signUp.isSuccess) {
    return (
      <AuthCard title="Account created">
        <Callout tone="success">You can now sign in with your new account.</Callout>
        <Link to="/sign-in" className={buttonClassName({ className: 'w-full' })}>
          Sign in
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Create your account"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/sign-in" className={textLinkClassName()}>
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input
          label="Name"
          name="name"
          autoComplete="name"
          required
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value)
          }}
        />
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
        <Input
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          description="At least 8 characters."
          {...(passwordTouched && passwordTooShort
            ? { error: 'Password must be at least 8 characters.' }
            : {})}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
          }}
          onBlur={() => {
            setPasswordTouched(true)
          }}
        />
        <FormError error={signUp.error} />
        <Button type="submit" loading={signUp.isPending} className="mt-1 w-full">
          Create account
        </Button>
      </form>
    </AuthCard>
  )
}
