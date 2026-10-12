import { act, renderHook } from '@testing-library/react'
import type { ChangeEvent } from 'react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '../api/index.ts'
import { schemaFromRules, type StandardSchemaV1 } from './standard-schema.ts'
import { useFormValidation } from './use-form-validation.ts'
import { emailRule, requiredRule } from './validation.ts'

const SCHEMA = schemaFromRules({ email: emailRule, password: requiredRule('Enter your password.') })

const EMAIL_PROBLEM = 'Enter a valid email address, like name@example.com.'

function formWith(...names: string[]): HTMLFormElement {
  const form = document.createElement('form')
  for (const name of names) {
    const input = document.createElement('input')
    input.name = name
    form.append(input)
  }
  document.body.append(form)
  return form
}

const serverSaysEmailIsInvalid = new ApiError(400, {
  code: 'validation_error',
  message: 'body/email must match format "email"',
  details: [{ instancePath: '/email', keyword: 'format', params: { format: 'email' } }],
})

/** The part of a change event the hook reads: which field was edited. */
function editing(name: string): ChangeEvent<HTMLFormElement> {
  const input = document.createElement('input')
  input.name = name
  return { target: input } as unknown as ChangeEvent<HTMLFormElement>
}

describe('useFormValidation', () => {
  it('has no errors until something is validated', () => {
    const { result } = renderHook(() => useFormValidation(SCHEMA))

    expect(result.current.errors).toEqual({})
  })

  it('resolves to the schema’s output when every field is fine', async () => {
    const { result } = renderHook(() => useFormValidation(SCHEMA))
    const values = { email: 'a@example.com', password: 'x' }

    const output = await act(() => result.current.validate(values, formWith('email', 'password')))

    expect(output).toEqual(values)
    expect(result.current.errors).toEqual({})
  })

  it('reports every failing field at once, and resolves to nothing', async () => {
    const { result } = renderHook(() => useFormValidation(SCHEMA))

    const output = await act(() =>
      result.current.validate({ email: 'nope', password: '' }, formWith('email', 'password')),
    )

    expect(output).toBeUndefined()
    expect(result.current.errors).toEqual({
      email: EMAIL_PROBLEM,
      password: 'Enter your password.',
    })
  })

  it('puts focus on the first field with a problem', async () => {
    const { result } = renderHook(() => useFormValidation(SCHEMA))
    const form = formWith('email', 'password')

    await act(() => result.current.validate({ email: 'nope', password: '' }, form))

    expect(document.activeElement).toBe(form.elements.namedItem('email'))
  })

  it('forgets the message on the field being edited, and keeps the others', async () => {
    const { result } = renderHook(() => useFormValidation(SCHEMA))
    await act(() =>
      result.current.validate({ email: 'nope', password: '' }, formWith('email', 'password')),
    )

    act(() => {
      result.current.clearOnChange(editing('email'))
    })

    expect(result.current.errors).toEqual({ password: 'Enter your password.' })
  })

  it('takes any Standard Schema, and says what belongs to no single field', async () => {
    const passwordsMustMatch: StandardSchemaV1<unknown, string> = {
      '~standard': {
        version: 1,
        vendor: 'some-other-library',
        validate: () => ({ issues: [{ message: 'The passwords differ.' }] }),
      },
    }
    const { result } = renderHook(() => useFormValidation(passwordsMustMatch))

    const output = await act(() => result.current.validate({}, formWith('password')))

    expect(output).toBeUndefined()
    expect(result.current.formLevel(undefined)).toBe('The passwords differ.')
  })

  it('adopts the server’s messages for fields the form has, and ignores the rest', () => {
    const { result } = renderHook(() => useFormValidation(SCHEMA))
    const form = formWith('email', 'password')

    act(() => {
      result.current.adopt(serverSaysEmailIsInvalid, form)
      result.current.adopt(
        new ApiError(400, {
          code: 'validation_error',
          message: 'x',
          details: [{ instancePath: '/elsewhere', keyword: 'required', params: {} }],
        }),
        form,
      )
    })

    expect(result.current.errors).toEqual({ email: EMAIL_PROBLEM })
  })

  it('shows the submission error unless the fields already carry it', () => {
    const { result } = renderHook(() => useFormValidation(SCHEMA))
    const unrelated = new ApiError(401, { code: 'invalid_credentials', message: 'Incorrect' })
    expect(result.current.formLevel(serverSaysEmailIsInvalid)).toBe(serverSaysEmailIsInvalid)

    act(() => {
      result.current.adopt(serverSaysEmailIsInvalid, formWith('email'))
    })

    expect(result.current.formLevel(serverSaysEmailIsInvalid)).toBeUndefined()
    expect(result.current.formLevel(unrelated)).toBe(unrelated)
  })
})
