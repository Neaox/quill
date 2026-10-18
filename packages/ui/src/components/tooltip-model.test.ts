import { describe, expect, it } from 'vitest'

import { createTooltipTiming } from './tooltip-model.ts'

describe('createTooltipTiming', () => {
  it('is cold until a tip opens, warm while one shows, and for the skip window after', () => {
    let now = 0
    const timing = createTooltipTiming(300, 200, () => now)

    expect(timing.isWarm()).toBe(false)
    timing.opened()
    now = 10_000
    expect(timing.isWarm()).toBe(true)

    timing.closed()
    now += 199
    expect(timing.isWarm()).toBe(true)
    now += 1
    expect(timing.isWarm()).toBe(false)
  })

  it('stays warm while any tip in the group is still showing', () => {
    let now = 0
    const timing = createTooltipTiming(300, 200, () => now)

    timing.opened()
    timing.opened()
    timing.closed()
    now = 1_000
    expect(timing.isWarm()).toBe(true)
    timing.closed()
    expect(timing.isWarm()).toBe(true)
    now = 1_200
    expect(timing.isWarm()).toBe(false)
  })
})
