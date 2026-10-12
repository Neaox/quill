import { describe, expect, it } from 'vitest'

import { BRAND } from '@quill/brand'

import { emailRule, requiredRule } from './validation.ts'
import {
  fieldErrorsFromIssues,
  schemaFromRules,
  validateWith,
  type StandardSchemaV1,
} from './standard-schema.ts'

/**
 * A schema as any conforming library would hand one over: an object with a
 * `~standard` property, here written by hand so the tests do not depend on
 * which library the project happens to use.
 */
function schemaThatSays(
  issues: readonly { message: string; path?: readonly (PropertyKey | { key: PropertyKey })[] }[],
  { async = false }: { async?: boolean } = {},
): StandardSchemaV1<unknown, string> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: () => {
        const result = issues.length === 0 ? { value: 'ok' } : { issues }
        return async ? Promise.resolve(result) : result
      },
    },
  }
}

describe('fieldErrorsFromIssues', () => {
  it('keys the first message of each field by the first step of its path', () => {
    const { fields, rest } = fieldErrorsFromIssues([
      { message: 'Bad address.', path: ['email'] },
      { message: 'Also bad.', path: ['email'] },
      { message: 'Too short.', path: ['password', 0] },
    ])

    expect(fields).toEqual({ email: 'Bad address.', password: 'Too short.' })
    expect(rest).toEqual([])
  })

  it('reads a path step written as an object, as the specification allows', () => {
    const { fields } = fieldErrorsFromIssues([{ message: 'Bad.', path: [{ key: 'email' }] }])

    expect(fields).toEqual({ email: 'Bad.' })
  })

  it('keeps what belongs to no single field apart, rather than dropping it', () => {
    const { fields, rest } = fieldErrorsFromIssues([
      { message: 'The passwords differ.' },
      { message: 'And this.', path: [] },
    ])

    expect(fields).toEqual({})
    expect(rest).toEqual(['The passwords differ.', 'And this.'])
  })
})

describe('validateWith', () => {
  it('hands back the schema’s own output when there is nothing to report', async () => {
    expect(await validateWith(schemaThatSays([]), {})).toEqual({ ok: true, value: 'ok' })
  })

  it('waits for a schema that answers later', async () => {
    const result = await validateWith(
      schemaThatSays([{ message: 'No.', path: ['a'] }], { async: true }),
      {},
    )

    expect(result).toEqual({ ok: false, fields: { a: 'No.' }, rest: [] })
  })

  it('passes the values to the schema untouched', async () => {
    let received: unknown
    const schema: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) => {
          received = value
          return { value }
        },
      },
    }

    await validateWith(schema, { email: ' x ' })

    expect(received).toEqual({ email: ' x ' })
  })
})

describe('schemaFromRules', () => {
  const schema = schemaFromRules({
    email: emailRule,
    password: requiredRule('Enter your password.'),
  })

  it('is a standard schema, so a form cannot tell it from any other library’s', () => {
    expect(schema['~standard'].version).toBe(1)
    expect(schema['~standard'].vendor).toBe(BRAND.slug)
  })

  it('accepts values that satisfy every rule, and gives them back', async () => {
    const values = { email: 'a@example.com', password: 'x' }

    expect(await validateWith(schema, values)).toEqual({ ok: true, value: values })
  })

  it('reports every rule that fails, against the field it belongs to', async () => {
    const result = await validateWith(schema, { email: 'nope', password: '' })

    expect(result).toEqual({
      ok: false,
      fields: {
        email: 'Enter a valid email address, like name@example.com.',
        password: 'Enter your password.',
      },
      rest: [],
    })
  })

  it('treats a field that is not there as empty', async () => {
    const result = await validateWith(schema, {})

    expect(result.ok).toBe(false)
  })

  it('refuses what is not a set of values at all', async () => {
    const result = await validateWith(schema, 'nope')

    expect(result).toEqual({ ok: false, fields: {}, rest: ['Expected the form’s values.'] })
  })
})
