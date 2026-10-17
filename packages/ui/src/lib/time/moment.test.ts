import { describe, expect, it } from 'vitest'

import { FULL_MOMENT, formatMoment, toMilliseconds, toMoment } from './moment.ts'

const MOMENT = new Date('2026-10-03T14:30:00Z')

describe('moment', () => {
  it('says a moment in each of its styles, in the reader’s language', () => {
    const said = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('en', options).format(MOMENT)

    expect(formatMoment(MOMENT, 'date', 'en')).toBe(said({ dateStyle: 'medium' }))
    expect(formatMoment(MOMENT, 'month-day', 'en')).toBe(said({ day: 'numeric', month: 'short' }))
    expect(formatMoment(MOMENT, 'datetime', 'en')).toBe(
      said({ dateStyle: 'medium', timeStyle: 'short' }),
    )
    expect(formatMoment(MOMENT, 'time', 'en')).toBe(said({ timeStyle: 'short' }))
  })

  it('says a moment in options of its own, such as the full one a hover shows', () => {
    expect(formatMoment(MOMENT, FULL_MOMENT, 'en')).toBe(
      new Intl.DateTimeFormat('en', FULL_MOMENT).format(MOMENT),
    )
  })

  it('says it in the platform’s language when none is asked for, the same each time', () => {
    const first = formatMoment(MOMENT, 'date')
    expect(formatMoment(MOMENT, 'date')).toBe(first)
    expect(first).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(MOMENT))
  })

  it('turns a string, a number or a date into milliseconds, and NaN for what is not a moment', () => {
    expect(toMilliseconds(MOMENT)).toBe(MOMENT.getTime())
    expect(toMilliseconds('2026-10-03T14:30:00Z')).toBe(MOMENT.getTime())
    expect(toMilliseconds(MOMENT.getTime())).toBe(MOMENT.getTime())
    expect(toMilliseconds('not a date')).toBeNaN()
  })

  it('turns a value into a date, and nothing for what is not a moment', () => {
    expect(toMoment(MOMENT)).toBe(MOMENT)
    expect(toMoment('2026-10-03T14:30:00Z')).toEqual(MOMENT)
    expect(toMoment('not a date')).toBeUndefined()
    expect(toMoment(new Date(Number.NaN))).toBeUndefined()
  })
})
