import { describe, expect, it } from 'vitest'

import { requireRow } from './rows.ts'

describe('requireRow', () => {
  it('returns the row when present', () => {
    expect(requireRow({ id: 1 }, 'unreachable')).toEqual({ id: 1 })
  })

  it('throws with the given message when the row is undefined', () => {
    expect(() => requireRow(undefined, 'expected a row')).toThrow('expected a row')
  })
})
