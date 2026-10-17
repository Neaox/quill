import { getRouteApi, Link } from '@tanstack/react-router'
import type { FormEvent } from 'react'

import { Button, buttonClassName, Callout, Input, Spinner, textLinkClassName } from '@quill/ui'

import { ApiError, useConsumeMagicLink, useRequestMagicLink } from '../../lib/api/index.ts'
import { AuthCard } from './auth-card.tsx'
import { FormError } from '../../lib/forms/form-error.tsx'
import { formValues } from '../../lib/forms/form-values.ts'
import { schemaFromRules } from '../../lib/forms/standard-schema.ts'
import { useFormValidation } from '../../lib/forms/use-form-validation.ts'
import { emailRule } from '../../lib/forms/validation.ts'
import { useConsumeOnMount } from './use-consume-on-mount.ts'

const routeApi = getRouteApi('/magic-link')

const REQUEST_SCHEMA = schemaFromRules({ email: emailRule })

function ConsumeMagicLink({ token }: { readonly token: string }) {
  const consume = useConsumeMagicLink()
  const navigate = routeApi.useNavigate()
  useConsumeOnMount(token, (value) => {
    consume.mutate(value, {
      onSuccess: () => {
        void navigate({ to: '/' })
      },
    })
  })

  if (consume.isError) {
    return (
      <AuthCard title="This link didn't work">
        <Callout tone="danger">
          {consume.error instanceof ApiError
            ? consume.error.message
            : 'This link is invalid, expired, or already used.'}
        </Callout>
        <Link
          to="/magic-link"
          className={buttonClassName({ variant: 'secondary', size: 'lg', className: 'w-full' })}
        >
          Request a new link
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Signing you in">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner />
        Verifying your link…
      </div>
    </AuthCard>
  )
}

function RequestMagicLink() {
  const requestLink = useRequestMagicLink()
  const validation = useFormValidation(REQUEST_SCHEMA)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    void validation.validate(formValues(form), form).then((values) => {
      if (values === undefined) return
      requestLink.mutate(
        { email: (values['email'] ?? '').trim(), purpose: 'sign-in' },
        {
          onError: (failure) => {
            validation.adopt(failure, form)
          },
        },
      )
    })
  }

  if (requestLink.isSuccess) {
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
          If an account exists for {requestLink.variables.email}, a sign-in link is on its way.
        </Callout>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Email me a sign-in link"
      description="We will send a link that signs you in on this device, with no password to remember."
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
        <FormError error={validation.formLevel(requestLink.error)} />
        <Button type="submit" size="lg" loading={requestLink.isPending} className="mt-2 w-full">
          Send link
        </Button>
      </form>
    </AuthCard>
  )
}

/** Request a sign-in link (no `token`) or consume one (`?token=`) — one route, two phases. */
export function MagicLinkPage() {
  const { token } = routeApi.useSearch()
  if (token !== undefined) return <ConsumeMagicLink token={token} />
  return <RequestMagicLink />
}
