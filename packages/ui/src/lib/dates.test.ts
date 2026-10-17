import { describe, expect, it } from 'vitest'

import { absoluteDate, relativeDate } from './dates.ts'

const NOW = new Date(Date.UTC(2026, 9, 17, 9, 0))

describe('dates a reader can read', () => {
  it('says a date in full, in UTC so a calendar date never slips a day', () => {
    expect(absoluteDate(new Date(Date.UTC(2026, 2, 1)))).toBe('1 Mar 2026')
  })

  it('says how long ago, or how long until, in the largest unit that fits', () => {
    expect(relativeDate(new Date(Date.UTC(2026, 9, 17)), NOW)).toBe('today')
    expect(relativeDate(new Date(Date.UTC(2026, 9, 16)), NOW)).toBe('yesterday')
    expect(relativeDate(new Date(Date.UTC(2026, 9, 18)), NOW)).toBe('tomorrow')
    expect(relativeDate(new Date(Date.UTC(2026, 9, 10)), NOW)).toBe('last week')
    expect(relativeDate(new Date(Date.UTC(2026, 9, 3)), NOW)).toBe('2 weeks ago')
    expect(relativeDate(new Date(Date.UTC(2026, 6, 12)), NOW)).toBe('3 months ago')
    expect(relativeDate(new Date(Date.UTC(2027, 0, 20)), NOW)).toBe('in 3 months')
    expect(relativeDate(new Date(Date.UTC(2024, 9, 1)), NOW)).toBe('2 years ago')
    expect(relativeDate(new Date(Date.UTC(2026, 9, 12)), NOW)).toBe('5 days ago')
  })
})
