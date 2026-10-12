import { describe, expect, it } from 'vitest'

import { ApiError } from '../api/index.ts'
import { describeError } from './describe-error.ts'

const validationError = (details: unknown) =>
  new ApiError(400, {
    code: 'validation_error',
    message: 'body/email must match format "email"',
    details,
  })

describe('describeError', () => {
  it('puts a server message, written for people, in front of them as it is', () => {
    expect(
      describeError(
        new ApiError(401, { code: 'invalid_credentials', message: 'Incorrect email or password' }),
      ),
    ).toBe('Incorrect email or password')
  })

  it('does not show the validator’s phrasing for a validation failure', () => {
    expect(describeError(validationError([]))).toBe(
      'Some of what you entered is not valid. Check the fields below and try again.',
    )
  })

  it('says the server cannot be reached when the request never got an answer', () => {
    expect(describeError(new TypeError('Failed to fetch'))).toBe(
      'Could not reach the server. Check your connection and try again.',
    )
  })

  it('shows a plain message as it is, such as what a schema said about the form as a whole', () => {
    expect(describeError('The passwords differ.')).toBe('The passwords differ.')
  })

  it('gives anything else a plain sentence rather than its stack', () => {
    expect(describeError(new Error('boom'))).toBe('Something went wrong. Please try again.')
    expect(describeError(42)).toBe('Something went wrong. Please try again.')
    expect(describeError(undefined)).toBe('Something went wrong. Please try again.')
  })
})
