import { ApiError } from '../api/index.ts'

export interface FormErrorProps {
  readonly error: unknown
}

/**
 * A submission-level error message, announced the moment it appears.
 *
 * `role="alert"` makes this an assertive live region without any extra
 * wiring: screen readers announce it as soon as it mounts, which is what a
 * failed sign-in or a lost lock needs. Renders nothing for no error, so a
 * form can place it unconditionally.
 */
export function FormError({ error }: FormErrorProps) {
  if (error === undefined || error === null) return undefined

  const message =
    error instanceof ApiError ? error.message : 'Something went wrong. Please try again.'

  return (
    <p role="alert" className="text-sm leading-relaxed text-danger">
      {message}
    </p>
  )
}
