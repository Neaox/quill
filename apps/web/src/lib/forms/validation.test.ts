import { describe, expect, it } from 'vitest'

import { ApiError } from '../api/index.ts'
import { allOf, emailRule, fieldErrorsFrom, minLengthRule, requiredRule } from './validation.ts'

const validationError = (details: unknown) =>
  new ApiError(400, {
    code: 'validation_error',
    message: 'body/email must match format "email"',
    details,
  })

describe('requiredRule', () => {
  const rule = requiredRule('Enter your password.')

  it('refuses nothing and whitespace alike', () => {
    expect(rule('')).toBe('Enter your password.')
    expect(rule('   ')).toBe('Enter your password.')
  })

  it('accepts anything else', () => {
    expect(rule('x')).toBeUndefined()
  })
})

describe('emailRule', () => {
  it.each(['', '  '])('asks for an address when given %j', (value) => {
    expect(emailRule(value)).toBe('Enter your email address.')
  })

  it.each(['admin', 'admin@', '@example.com', 'a b@example.com', 'admin@localhost', 'a@@b.com'])(
    'says what is wrong with %j, and shows a valid one',
    (value) => {
      expect(emailRule(value)).toBe('Enter a valid email address, like name@example.com.')
    },
  )

  it.each(['admin@example.com', 'first.last+tag@mail.example.co.uk', '  padded@example.com  '])(
    'accepts %j',
    (value) => {
      expect(emailRule(value)).toBeUndefined()
    },
  )
})

describe('minLengthRule', () => {
  it('counts characters, and says how many are needed', () => {
    const rule = minLengthRule(8)

    expect(rule('1234567')).toBe('Use at least 8 characters.')
    expect(rule('12345678')).toBeUndefined()
  })

  it('leaves an empty field to the required rule', () => {
    expect(minLengthRule(8)('')).toBeUndefined()
  })
})

describe('fieldErrorsFrom', () => {
  it('reads a format failure as a message for the field it names', () => {
    const error = validationError([
      {
        instancePath: '/email',
        keyword: 'format',
        params: { format: 'email' },
        message: 'must match format "email"',
      },
    ])

    expect(fieldErrorsFrom(error)).toEqual({
      email: 'Enter a valid email address, like name@example.com.',
    })
  })

  it('reads a missing property from the schema, where there is no path to the field', () => {
    const error = validationError([
      { instancePath: '', keyword: 'required', params: { missingProperty: 'password' } },
    ])

    expect(fieldErrorsFrom(error)).toEqual({ password: 'This field is required.' })
  })

  it('says how short a too-short value was allowed to be', () => {
    const error = validationError([
      { instancePath: '/password', keyword: 'minLength', params: { limit: 8 } },
    ])

    expect(fieldErrorsFrom(error)).toEqual({ password: 'Use at least 8 characters.' })
  })

  it('keeps the first problem per field, and one for each field', () => {
    const error = validationError([
      { instancePath: '/email', keyword: 'format', params: { format: 'email' } },
      { instancePath: '/email', keyword: 'minLength', params: { limit: 3 } },
      { instancePath: '/password', keyword: 'maxLength', params: { limit: 200 } },
    ])

    expect(fieldErrorsFrom(error)).toEqual({
      email: 'Enter a valid email address, like name@example.com.',
      password: 'Use no more than 200 characters.',
    })
  })

  it('falls back to the validator’s own words, capitalised, for a keyword it does not know', () => {
    const error = validationError([
      { instancePath: '/email', keyword: 'pattern', params: {}, message: 'must match pattern' },
    ])

    expect(fieldErrorsFrom(error)).toEqual({ email: 'Must match pattern.' })
  })

  it.each([
    ['an error that is not an API error', new Error('boom')],
    [
      'another kind of API error',
      new ApiError(401, { code: 'invalid_credentials', message: 'no' }),
    ],
    ['details that are not a list', validationError('nope')],
    ['entries that are not issues', validationError([null, 3, { keyword: 'format' }])],
    [
      'a nested path, which no form field has',
      validationError([{ instancePath: '/a/b', keyword: 'type' }]),
    ],
  ])('reads %s as no field errors', (_name, error) => {
    expect(fieldErrorsFrom(error)).toEqual({})
  })
})

describe('allOf', () => {
  const rule = allOf(requiredRule('Choose a password.'), minLengthRule(8))

  it('says the first thing that is wrong, and no more', () => {
    expect(rule('')).toBe('Choose a password.')
    expect(rule('short')).toBe('Use at least 8 characters.')
  })

  it('accepts a value every rule accepts', () => {
    expect(rule('long enough')).toBeUndefined()
  })
})
