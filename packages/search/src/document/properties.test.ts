import { describe, expect, it } from 'vitest'

import {
  MAX_PROPERTY_KEY_LENGTH,
  MAX_PROPERTY_KEYS,
  MAX_PROPERTY_VALUE_LENGTH,
  MAX_PROPERTY_VALUES,
  extractProperties,
} from './properties.ts'

describe('extractProperties', () => {
  it('takes scalars and arrays of scalars under keys that are not core fields', () => {
    expect(
      extractProperties({
        severity: 'High',
        attempts: 3,
        reviewed: true,
        regions: ['EU', 'us-east'],
      }),
    ).toEqual({
      severity: ['high'],
      attempts: ['3'],
      reviewed: ['true'],
      regions: ['eu', 'us-east'],
    })
  })

  it.each([
    'id',
    'title',
    'description',
    'type',
    'status',
    'owners',
    'tags',
    'order',
    'layout',
    'review',
    'template',
  ])('never reads the core field %s as a property', (core) => {
    expect(extractProperties({ [core]: 'x' })).toEqual({})
  })

  it('drops objects, nulls, nested arrays and anything else that is not a scalar', () => {
    expect(
      extractProperties({
        object: { a: 1 },
        nothing: null,
        missing: undefined,
        nested: [['a']],
        mixed: ['keep', { a: 1 }, null, ['x'], 2, false],
        fn: () => 1,
        big: 10n,
        infinite: Number.POSITIVE_INFINITY,
        notANumber: Number.NaN,
      }),
    ).toEqual({ mixed: ['keep', '2', 'false'] })
  })

  it('lower-cases and trims keys, merging keys that collide', () => {
    expect(extractProperties({ ' Severity ': 'High', SEVERITY: ['low', 'high'] })).toEqual({
      severity: ['high', 'low'],
    })
  })

  it('lower-cases and trims values, and drops those that are empty', () => {
    expect(extractProperties({ team: ['  Platform ', '', '   '], empty: '  ' })).toEqual({
      team: ['platform'],
    })
  })

  it('drops keys that are empty after trimming or longer than the limit', () => {
    expect(
      extractProperties({
        '  ': 'x',
        [`${'k'.repeat(MAX_PROPERTY_KEY_LENGTH)}`]: 'kept',
        [`${'k'.repeat(MAX_PROPERTY_KEY_LENGTH + 1)}`]: 'dropped',
      }),
    ).toEqual({ [`${'k'.repeat(MAX_PROPERTY_KEY_LENGTH)}`]: ['kept'] })
  })

  it('drops a value longer than the limit rather than storing part of it', () => {
    expect(
      extractProperties({
        note: ['a'.repeat(MAX_PROPERTY_VALUE_LENGTH), 'b'.repeat(MAX_PROPERTY_VALUE_LENGTH + 1)],
      }),
    ).toEqual({ note: ['a'.repeat(MAX_PROPERTY_VALUE_LENGTH)] })
  })

  it('keeps the first values of a key, once each, up to the limit', () => {
    const values = Array.from({ length: MAX_PROPERTY_VALUES + 5 }, (_unused, at) => `v${at}`)
    expect(extractProperties({ many: ['v0', ...values] })['many']).toEqual(
      values.slice(0, MAX_PROPERTY_VALUES),
    )
  })

  it('keeps the first keys in key order, up to the limit', () => {
    const front = Object.fromEntries(
      Array.from({ length: MAX_PROPERTY_KEYS + 3 }, (_unused, at) => [
        `key${String(at).padStart(2, '0')}`,
        'v',
      ]).toReversed(),
    )
    const kept = Object.keys(extractProperties(front))
    expect(kept).toHaveLength(MAX_PROPERTY_KEYS)
    expect(kept.at(0)).toBe('key00')
    expect(kept.at(-1)).toBe(`key${String(MAX_PROPERTY_KEYS - 1).padStart(2, '0')}`)
  })

  it('has no properties without any front matter beyond the core', () => {
    expect(extractProperties({})).toEqual({})
  })
})
