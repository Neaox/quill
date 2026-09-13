import { describe, expect, it } from 'vitest'
import { createFakeClock, systemClock } from './clock.ts'

describe('systemClock', () => {
  it('reports wall-clock time', () => {
    const before = Date.now()
    const now = systemClock.now()
    expect(now).toBeGreaterThanOrEqual(before)
    expect(now).toBeLessThanOrEqual(Date.now())
  })

  it('runs a scheduled handler', async () => {
    const ran = await new Promise<boolean>((resolve) => {
      systemClock.setTimeout(() => {
        resolve(true)
      }, 0)
    })
    expect(ran).toBe(true)
  })

  it('cancels a scheduled handler by its numeric handle', async () => {
    let ran = false
    const handle = systemClock.setTimeout(() => {
      ran = true
    }, 0)
    expect(typeof handle).toBe('number')
    systemClock.clearTimeout(handle)
    await new Promise<void>((resolve) => {
      systemClock.setTimeout(() => {
        resolve()
      }, 5)
    })
    expect(ran).toBe(false)
  })
})

describe('createFakeClock', () => {
  it('starts at zero and does not move on its own', () => {
    const clock = createFakeClock()
    expect(clock.now()).toBe(0)
    expect(clock.now()).toBe(0)
    expect(clock.pending).toBe(0)
  })

  it('starts at an explicit time', () => {
    expect(createFakeClock(1_700_000_000_000).now()).toBe(1_700_000_000_000)
  })

  it('runs a handler only once its delay has elapsed', () => {
    const clock = createFakeClock()
    const seen: number[] = []
    clock.setTimeout(() => seen.push(clock.now()), 100)

    clock.advance(99)
    expect(seen).toEqual([])
    expect(clock.pending).toBe(1)

    clock.advance(1)
    expect(seen).toEqual([100])
    expect(clock.pending).toBe(0)
    expect(clock.now()).toBe(100)
  })

  it('runs due handlers earliest first, whatever order they were scheduled in', () => {
    const clock = createFakeClock()
    const seen: string[] = []
    clock.setTimeout(() => seen.push('late'), 30)
    clock.setTimeout(() => seen.push('early'), 10)
    clock.setTimeout(() => seen.push('middle'), 20)

    clock.advance(100)
    expect(seen).toEqual(['early', 'middle', 'late'])
  })

  it('keeps insertion order for handlers due at the same instant', () => {
    const clock = createFakeClock()
    const seen: string[] = []
    clock.setTimeout(() => seen.push('first'), 10)
    clock.setTimeout(() => seen.push('second'), 10)

    clock.advance(10)
    expect(seen).toEqual(['first', 'second'])
  })

  it('runs work a handler schedules inside the same advance', () => {
    const clock = createFakeClock()
    const seen: number[] = []
    const tick = (remaining: number) => () => {
      seen.push(clock.now())
      if (remaining > 0) clock.setTimeout(tick(remaining - 1), 10)
    }
    clock.setTimeout(tick(2), 10)

    clock.advance(100)
    expect(seen).toEqual([10, 20, 30])
    expect(clock.now()).toBe(100)
  })

  it('leaves work scheduled beyond the advance pending', () => {
    const clock = createFakeClock()
    clock.setTimeout(() => clock.setTimeout(() => undefined, 1000), 10)

    clock.advance(20)
    expect(clock.pending).toBe(1)
    expect(clock.now()).toBe(20)
  })

  it('cancels a handler', () => {
    const clock = createFakeClock()
    let ran = false
    const handle = clock.setTimeout(() => {
      ran = true
    }, 10)
    clock.setTimeout(() => undefined, 10)

    clock.clearTimeout(handle)
    expect(clock.pending).toBe(1)

    clock.advance(50)
    expect(ran).toBe(false)
  })

  it('ignores a handle that is not scheduled', () => {
    const clock = createFakeClock()
    clock.setTimeout(() => undefined, 10)
    clock.clearTimeout(999)
    expect(clock.pending).toBe(1)
  })
})
