import { getRouteApi, Link } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import { Button, Input, textLinkClassName } from '@quill/ui'

import { useSignIn } from '../../lib/api/index.ts'
import { AuthCard } from './auth-card.tsx'
import { FormError } from '../../lib/forms/form-error.tsx'

const routeApi = getRouteApi('/sign-in')

/**
 * Email and password sign-in.
 *
 * The `redirect` search param is the return path a 401 (or an unauthenticated
 * visit to a protected route) was sent here with; a successful sign-in goes
 * straight back to it (task requirement: "preserves the return path").
 */
export function SignInPage() {
  const { redirect } = routeApi.useSearch()
  const navigate = routeApi.useNavigate()
  const signIn = useSignIn()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    signIn.mutate(
      { email, password },
      {
        onSuccess: () => {
          void navigate({ to: redirect ?? '/' })
        },
      },
    )
  }

  return (
    <AuthCard
      title="Sign in"
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link to="/sign-up" className={textLinkClassName()}>
            Sign up
          </Link>
        </>
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
        <Input
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
          }}
        />
        <FormError error={signIn.error} />
        <Button type="submit" loading={signIn.isPending} className="mt-1 w-full">
          Sign in
        </Button>
      </form>
      <div className="flex justify-between text-sm">
        <Link to="/magic-link" className={textLinkClassName()}>
          Email me a link
        </Link>
        <Link to="/reset-password" className={textLinkClassName()}>
          Forgot password?
        </Link>
      </div>
    </AuthCard>
  )
}
