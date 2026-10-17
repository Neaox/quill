import { getRouteApi, Link } from '@tanstack/react-router'
import type { FormEvent } from 'react'

import { Button, buttonClassName, Callout, Input, textLinkClassName } from '@quill/ui'

import { useConfirmPasswordReset, useRequestPasswordReset } from '../../lib/api/index.ts'
import { AuthCard } from './auth-card.tsx'
import { FormError } from '../../lib/forms/form-error.tsx'
import { formValues } from '../../lib/forms/form-values.ts'
import { schemaFromRules } from '../../lib/forms/standard-schema.ts'
import { useFormValidation } from '../../lib/forms/use-form-validation.ts'
import {
  allOf,
  emailRule,
  MIN_PASSWORD_LENGTH,
  minLengthRule,
  requiredRule,
} from '../../lib/forms/validation.ts'

const routeApi = getRouteApi('/reset-password')

const REQUEST_SCHEMA = schemaFromRules({ email: emailRule })
const CONFIRM_SCHEMA = schemaFromRules({
  newPassword: allOf(requiredRule('Choose a new password.'), minLengthRule(MIN_PASSWORD_LENGTH)),
})

function ConfirmReset({ token }: { readonly token: string }) {
  const confirmReset = useConfirmPasswordReset()
  const validation = useFormValidation(CONFIRM_SCHEMA)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    void validation.validate(formValues(form), form).then((values) => {
      if (values === undefined) return
      confirmReset.mutate(
        { token, newPassword: values['newPassword'] ?? '' },
        {
          onError: (failure) => {
            validation.adopt(failure, form)
          },
        },
      )
    })
  }

  if (confirmReset.isSuccess) {
    return (
      <AuthCard title="Password updated">
        <Callout tone="success">Your password has been changed.</Callout>
        <Link to="/sign-in" className={buttonClassName({ size: 'lg', className: 'w-full' })}>
          Sign in
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Choose a new password"
      description="Pick a password you do not use anywhere else."
    >
      <form
        onSubmit={handleSubmit}
        onChange={validation.clearOnChange}
        className="flex flex-col gap-5"
        noValidate
      >
        <Input
          size="lg"
          label="New password"
          type="password"
          name="newPassword"
          autoComplete="new-password"
          required
          description={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          error={validation.errors['newPassword']}
        />
        <FormError error={validation.formLevel(confirmReset.error)} />
        <Button type="submit" size="lg" loading={confirmReset.isPending} className="mt-2 w-full">
          Update password
        </Button>
      </form>
    </AuthCard>
  )
}

function RequestReset() {
  const requestReset = useRequestPasswordReset()
  const validation = useFormValidation(REQUEST_SCHEMA)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    void validation.validate(formValues(form), form).then((values) => {
      if (values === undefined) return
      requestReset.mutate((values['email'] ?? '').trim(), {
        onError: (failure) => {
          validation.adopt(failure, form)
        },
      })
    })
  }

  if (requestReset.isSuccess) {
    return (
      <AuthCard
        title="Check your email"
        footer={
          <Link to="/sign-in" className={textLinkClassName()}>
            Back to sign in
          </Link>
        }
      >
        <Callout tone="success">
          If an account exists for {requestReset.variables}, a password reset link is on its way.
        </Callout>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter the address you signed up with and we will send a link to choose a new password."
      footer={
        <Link to="/sign-in" className={textLinkClassName()}>
          Back to sign in
        </Link>
      }
    >
      <form
        onSubmit={handleSubmit}
        onChange={validation.clearOnChange}
        className="flex flex-col gap-5"
        noValidate
      >
        <Input
          size="lg"
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          error={validation.errors['email']}
        />
        <FormError error={validation.formLevel(requestReset.error)} />
        <Button type="submit" size="lg" loading={requestReset.isPending} className="mt-2 w-full">
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
