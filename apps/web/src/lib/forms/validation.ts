import { isValidationError } from './describe-error.ts'

/**
 * A rule answers with what is wrong with a value, or nothing when it is fine.
 * Rules are plain functions so a form lists them by field and a test calls
 * them directly.
 */
export type FieldRule = (value: string) => string | undefined

export type FieldErrors<Field extends string> = Partial<Record<Field, string>>

export function requiredRule(message: string): FieldRule {
  return (value) => (value.trim() === '' ? message : undefined)
}

const EMAIL_REQUIRED = 'Enter your email address.'
const EMAIL_INVALID = 'Enter a valid email address, like name@example.com.'

/**
 * Deliberately no stricter than the server, whose schema has the last word and
 * whose answer the form shows on the field if it disagrees: one `@`, no
 * spaces, and a dotted domain. A mistake worth catching before a round trip is
 * a missing `@` or a missing domain, not a rare but legal local part.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u

export const emailRule: FieldRule = (value) => {
  const email = value.trim()
  if (email === '') return EMAIL_REQUIRED
  return EMAIL_SHAPE.test(email) ? undefined : EMAIL_INVALID
}

/** An empty value is `requiredRule`'s to refuse, so the two read as one message at a time. */
export function minLengthRule(minimum: number): FieldRule {
  return (value) =>
    value !== '' && value.length < minimum ? `Use at least ${minimum} characters.` : undefined
}

/** The first problem any of the rules finds, so a field says one thing at a time. */
export function allOf(...rules: readonly FieldRule[]): FieldRule {
  return (value) => rules.map((rule) => rule(value)).find((problem) => problem !== undefined)
}

/** The shortest password the server accepts (`PASSWORD_MIN_LENGTH`, `apps/server/src/auth/password.ts`). */
export const MIN_PASSWORD_LENGTH = 12

function property(value: object, key: string): unknown {
  return key in value ? Reflect.get(value, key) : undefined
}

interface Issue {
  readonly field: string
  readonly message: string
}

function sentence(text: string): string {
  const capitalised = `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`
  return capitalised.endsWith('.') ? capitalised : `${capitalised}.`
}

function messageFor(keyword: string, params: object, validatorMessage: unknown): string {
  const limit = property(params, 'limit')
  if (keyword === 'format' && property(params, 'format') === 'email') return EMAIL_INVALID
  if (keyword === 'required') return 'This field is required.'
  if (keyword === 'minLength') return `Use at least ${String(limit)} characters.`
  if (keyword === 'maxLength') return `Use no more than ${String(limit)} characters.`
  return typeof validatorMessage === 'string' ? sentence(validatorMessage) : 'This is not valid.'
}

/** One problem from the server's validator, as a message for the field it names. */
function readIssue(value: unknown): Issue | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const keyword = property(value, 'keyword')
  const path = property(value, 'instancePath')
  if (typeof keyword !== 'string' || typeof path !== 'string') return undefined
  const rawParams = property(value, 'params')
  const params = typeof rawParams === 'object' && rawParams !== null ? rawParams : {}

  // A missing property has no path to it, only the schema's name for it.
  const field = path === '' ? property(params, 'missingProperty') : path.slice(1)
  if (typeof field !== 'string' || field === '' || field.includes('/')) return undefined

  return { field, message: messageFor(keyword, params, property(value, 'message')) }
}

/**
 * Messages for the fields a `400 validation_error` names (`details` is the
 * validator's list of problems), keyed by field. The first problem for a field
 * wins, because a person fixes one thing at a time.
 *
 * Anything else — another kind of error, details in a shape this does not
 * know, a problem with no single field to put it on — yields nothing, and the
 * form-level message (`describeError`) is what is shown.
 */
export function fieldErrorsFrom(error: unknown): Record<string, string> {
  if (!isValidationError(error) || !Array.isArray(error.details)) return {}
  const entries: readonly unknown[] = error.details
  const errors: Record<string, string> = {}
  for (const entry of entries) {
    const issue = readIssue(entry)
    if (issue !== undefined) errors[issue.field] ??= issue.message
  }
  return errors
}
