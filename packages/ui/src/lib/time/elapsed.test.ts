import { describe, expect, it } from 'vitest'

import { elapsedLabel, nextChangeAt } from './elapsed.ts'

const AT = Date.UTC(2026, 0, 1, 12, 0, 0)
const after = (seconds: number) => AT + seconds * 1000

describe('elapsedLabel', () => {
  it('says "just now" for under a minute, which is not worth counting', () => {
    expect(elapsedLabel(AT, after(0), 'en')).toBe('just now')
    expect(elapsedLabel(AT, after(44), 'en')).toBe('just now')
    expect(elapsedLabel(AT, after(-44), 'en')).toBe('just now')
  })

  it('counts in the largest unit that fits, in the language it is asked for', () => {
    expect(elapsedLabel(AT, after(45), 'en')).toBe('1 minute ago')
    expect(elapsedLabel(AT, after(125), 'en')).toBe('2 minutes ago')
    expect(elapsedLabel(AT, after(3 * 3600), 'en')).toBe('3 hours ago')
    expect(elapsedLabel(AT, after(86_400), 'en')).toBe('yesterday')
    expect(elapsedLabel(AT, after(3 * 86_400), 'en')).toBe('3 days ago')
    expect(elapsedLabel(AT, after(-3 * 3600), 'en')).toBe('in 3 hours')
    expect(elapsedLabel(AT, after(2 * 3600), 'fr')).toBe('il y a 2 heures')
  })

  it('says nothing for a moment that is not one', () => {
    expect(elapsedLabel(Number.NaN, AT, 'en')).toBe('')
  })
})

describe('nextChangeAt', () => {
  it('is when "just now" gives way to a minute, for a moment just passed', () => {
    expect(nextChangeAt(AT, after(10))).toBe(after(45))
  })

  it('is when a count rounds to the next, for a moment further back', () => {
    // At 2 minutes the saying is "2 minutes ago" until 2.5 minutes, when it rounds to 3.
    expect(elapsedLabel(AT, after(120), 'en')).toBe('2 minutes ago')
    expect(nextChangeAt(AT, after(120))).toBe(after(150))
    expect(elapsedLabel(AT, after(150), 'en')).toBe('3 minutes ago')
  })

  it('is the moment the saying differs, for every moment: never early, never late', () => {
    const moments = [0, 30, 44, 45, 59, 60, 119, 3599, 3600, 90_000, 5_000_000].map((seconds) => {
      const now = after(seconds)
      return { seconds, now, next: nextChangeAt(AT, now), label: elapsedLabel(AT, now, 'en') }
    })

    // At the moment it names, it reads differently.
    for (const { seconds, next, label } of moments) {
      expect(elapsedLabel(AT, next, 'en'), `at ${String(seconds)}s`).not.toBe(label)
    }
    // A second before it, where that is still ahead of now, it still reads as it does.
    const early = moments.filter(({ now, next }) => next - 1000 > now)
    expect(early.map(({ next }) => elapsedLabel(AT, next - 1000, 'en'))).toEqual(
      early.map(({ label }) => label),
    )
  })

  it('counts down for a moment to come', () => {
    expect(elapsedLabel(AT, after(-120), 'en')).toBe('in 2 minutes')
    const next = nextChangeAt(AT, after(-120))
    expect(elapsedLabel(AT, next, 'en')).not.toBe('in 2 minutes')
  })

  it('is never sooner than a second, so a moment on a boundary cannot spin a timer', () => {
    expect(nextChangeAt(AT, after(44.9999))).toBeGreaterThanOrEqual(after(44.9999) + 1000)
  })

  it('is never for a moment that is not one', () => {
    expect(nextChangeAt(Number.NaN, AT)).toBe(Number.POSITIVE_INFINITY)
  })
})
