import { describe, expect, it } from 'vitest'

import { relativeTime } from './relative-time.ts'

const NOW = Date.parse('2026-03-10T12:00:00.000Z')

describe('relativeTime', () => {
  it('says "just now" for the last few seconds rather than counting them', () => {
    expect(relativeTime('2026-03-10T11:59:30.000Z', NOW)).toBe('just now')
  })

  it('picks the largest whole unit that fits', () => {
    expect(relativeTime('2026-03-10T11:55:00.000Z', NOW)).toBe('5 minutes ago')
    expect(relativeTime('2026-03-10T09:00:00.000Z', NOW)).toBe('3 hours ago')
    expect(relativeTime('2026-03-09T12:00:00.000Z', NOW)).toBe('yesterday')
    expect(relativeTime('2026-02-24T12:00:00.000Z', NOW)).toBe('2 weeks ago')
    expect(relativeTime('2025-03-01T12:00:00.000Z', NOW)).toBe('last year')
  })

  it('says nothing about a timestamp it cannot read', () => {
    expect(relativeTime('not a date', NOW)).toBe('')
  })
})
