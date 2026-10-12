import { describe, expect, it } from 'vitest'

import { INITIAL_FIND } from './find-state.ts'
import type { FindState } from './find-state.ts'
import { matchSummary } from './find-summary.ts'

const [captured] = [...'x'.matchAll(/x/gu)]
if (captured === undefined) throw new Error('No match.')
const match = { from: 1, to: 2, captured }
const searching = (overrides: Partial<FindState>): FindState => ({
  ...INITIAL_FIND,
  open: true,
  query: 'x',
  pattern: { kind: 'ok', regex: /x/giu },
  ...overrides,
})

describe('what the find bar says about what it found', () => {
  it('says nothing until there is something to look for', () => {
    expect(matchSummary(searching({ query: '', pattern: { kind: 'empty' } }))).toBe('')
  })

  it('says there is nothing, when there is nothing', () => {
    expect(matchSummary(searching({}))).toBe('No results')
  })

  it('says which of how many the selection is on', () => {
    const found = { matches: [match, match, match], truncated: false }

    expect(matchSummary(searching({ found, current: 1 }))).toBe('2 of 3')
  })

  it('says how many there are when none is selected, in the singular for one', () => {
    expect(matchSummary(searching({ found: { matches: [match, match], truncated: false } }))).toBe(
      '2 results',
    )
    expect(matchSummary(searching({ found: { matches: [match], truncated: false } }))).toBe(
      '1 result',
    )
  })

  it('says where it stopped looking, in the number it stopped at', () => {
    const found = { matches: [match, match], truncated: true }

    expect(matchSummary(searching({ found, current: 0 }))).toBe('1 of 2+')
    expect(matchSummary(searching({ found }))).toBe('2+ results')
  })

  it('names a regular expression that is not one, in its own words', () => {
    expect(
      matchSummary(searching({ pattern: { kind: 'invalid', message: 'Unterminated group' } })),
    ).toBe('Invalid expression: Unterminated group')
  })
})
