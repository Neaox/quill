import { ApiError } from '../api/index.ts'

/** The code the server gives a request whose body or query failed its schema. */
const VALIDATION_ERROR = 'validation_error'

export function isValidationError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === VALIDATION_ERROR
}

/**
 * What to tell a person about a failed submission, in words rather than in the
 * validator's phrasing.
 *
 * A server message is written for people (`apps/server/src/errors.ts`) and is
 * shown as it is — except for a schema failure, whose message is the
 * validator's own (`body/email must match format "email"`) and whose useful
 * part is `details`, which `validation.ts` turns into messages on the fields.
 * A string is already a message, such as what a schema said about the form as
 * a whole. A request that never reached the server throws a `TypeError` from `fetch`;
 * "Failed to fetch" tells nobody what to do.
 */
export function describeError(error: unknown): string {
  if (typeof error === 'string') return error
  if (isValidationError(error)) {
    return 'Some of what you entered is not valid. Check the fields below and try again.'
  }
  if (error instanceof ApiError) return error.message
  if (error instanceof TypeError) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  return 'Something went wrong. Please try again.'
}
