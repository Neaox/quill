import { Link } from '@tanstack/react-router'
import type { FormEvent } from 'react'

import { Button, buttonClassName, Callout, Input, textLinkClassName } from '@quill/ui'

import { useSignUp } from '../../lib/api/index.ts'
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

const SIGN_UP_SCHEMA = schemaFromRules({
  displayName: requiredRule('Enter your name.'),
  email: emailRule,
  password: allOf(requiredRule('Choose a password.'), minLengthRule(MIN_PASSWORD_LENGTH)),
})

/**
 * Account creation. Sign-up does not sign the user in on its own
 * (`apps/server/src/application/auth-service.ts`'s `signUp` never sets a
 * session cookie), so success replaces the form with a link to sign in
 * rather than navigating there automatically.
 */
export function SignUpPage() {
  const signUp = useSignUp()
  const validation = useFormValidation(SIGN_UP_SCHEMA)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    void validation.validate(formValues(form), form).then((values) => {
      if (values === undefined) return
      const { displayName = '', email = '', password = '' } = values
      signUp.mutate(
        { displayName: displayName.trim(), email: email.trim(), password },
        {
          onError: (failure) => {
            validation.adopt(failure, form)
          },
        },
      )
    })
  }

  if (signUp.isSuccess) {
    return (
      <AuthCard
        title="Account created"
        description="Your account is ready. Sign in with the email and password you just chose."
      >
        <Callout tone="success">You can now sign in with your new account.</Callout>
        <Link to="/sign-in" className={buttonClassName({ size: 'lg', className: 'w-full' })}>
          Sign in
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Create your account"
      description="One account for every workspace you are invited to here."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/sign-in" className={textLinkClassName()}>
            Sign in
          </Link>
        </>
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
          label="Name"
          name="displayName"
          autoComplete="name"
          required
          error={validation.errors['displayName']}
        />
        <Input
          size="lg"
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          error={validation.errors['email']}
        />
        <Input
          size="lg"
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          description={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          error={validation.errors['password']}
        />
        <FormError error={validation.formLevel(signUp.error)} />
        <Button type="submit" size="lg" loading={signUp.isPending} className="mt-2 w-full">
          Create account
        </Button>
      </form>
    </AuthCard>
  )
}
