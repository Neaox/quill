import { describe, expect, it } from 'vitest'

import { createSystemClock } from './system-clock.ts'

describe('createSystemClock', () => {
  it('returns the current time', () => {
    const clock = createSystemClock()
    const before = Date.now()
    const now = clock.now().getTime()
    const after = Date.now()
    expect(now).toBeGreaterThanOrEqual(before)
    expect(now).toBeLessThanOrEqual(after)
  })
})
