import { afterEach, describe, expect, it } from 'vitest'

import {
  advanceGesture,
  canScrollFurther,
  GESTURE_PAUSE_MS,
  NEW_GESTURE,
  STEP_COOLDOWN_MS,
  STEP_DISTANCE,
  wheelPixels,
  type WheelGesture,
} from './wheel-step.ts'

describe('wheelPixels', () => {
  it('is pixels whatever the device reports', () => {
    expect(wheelPixels({ deltaY: 100, deltaMode: 0 })).toBe(100)
    expect(wheelPixels({ deltaY: 3, deltaMode: 1 })).toBe(48)
    expect(wheelPixels({ deltaY: 1, deltaMode: 2 })).toBe(100)
  })
})

describe('advanceGesture', () => {
  it('takes a step for one notch of a wheel, forward or back', () => {
    expect(advanceGesture(NEW_GESTURE, 100, 1000).step).toBe('next')
    expect(advanceGesture(NEW_GESTURE, -100, 1000).step).toBe('previous')
  })

  it('takes a swipe’s worth of small events to make a step, and only one', () => {
    let gesture: WheelGesture = NEW_GESTURE
    const steps: (string | undefined)[] = []
    for (let n = 0; n < 40; n += 1) {
      const moved = advanceGesture(gesture, 8, 1000 + n * 10)
      gesture = moved.gesture
      steps.push(moved.step)
    }

    // 40 events of 8 pixels over 400ms: one step at 60 pixels, and the rest is the swipe's tail.
    expect(steps.filter((step) => step === 'next')).toHaveLength(1)
    expect(steps.indexOf('next')).toBe(Math.ceil(STEP_DISTANCE / 8) - 1)
  })

  it('does not step for a little travel, and forgets it after a pause', () => {
    const first = advanceGesture(NEW_GESTURE, 30, 1000)
    expect(first.step).toBeUndefined()

    const later = advanceGesture(first.gesture, 30, 1000 + GESTURE_PAUSE_MS + 1)

    // A new gesture: the 30 before the pause is not counted.
    expect(later.step).toBeUndefined()
    expect(later.gesture.travelled).toBe(30)
  })

  it('does not take a second step until the cooldown is over', () => {
    const first = advanceGesture(NEW_GESTURE, 100, 1000)
    const soon = advanceGesture(first.gesture, 100, 1000 + STEP_COOLDOWN_MS - 1)
    const later = advanceGesture(soon.gesture, 100, 1000 + STEP_COOLDOWN_MS + GESTURE_PAUSE_MS + 1)

    expect(soon.step).toBeUndefined()
    expect(later.step).toBe('next')
  })

  it('counts forward and back against each other', () => {
    const forward = advanceGesture(NEW_GESTURE, 40, 1000)
    const back = advanceGesture(forward.gesture, -40, 1010)

    expect(back.gesture.travelled).toBe(0)
    expect(back.step).toBeUndefined()
  })
})

function scroller(position: { top: number; height: number; client: number }) {
  const element = document.createElement('div')
  element.style.overflowY = 'auto'
  Object.defineProperty(element, 'scrollHeight', { value: position.height })
  Object.defineProperty(element, 'clientHeight', { value: position.client })
  Object.defineProperty(element, 'scrollTop', { value: position.top, writable: true })
  const inner = document.createElement('p')
  element.append(inner)
  document.body.append(element)
  return inner
}

describe('canScrollFurther', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('is true over something with more to scroll in the direction the wheel is turning', () => {
    const inside = scroller({ top: 0, height: 1000, client: 200 })

    expect(canScrollFurther(inside, 100)).toBe(true)
    // At the top it has nothing to scroll back.
    expect(canScrollFurther(inside, -100)).toBe(false)
  })

  it('is false at the end of what scrolls, which is when the wheel steps', () => {
    const inside = scroller({ top: 800, height: 1000, client: 200 })

    expect(canScrollFurther(inside, 100)).toBe(false)
    expect(canScrollFurther(inside, -100)).toBe(true)
  })

  it('counts a scaled slide that stops a pixel or two short of its end as being at it', () => {
    // As the presenter's does: 898 + 194.84 reads short of a scroll height of 1094.
    const atEnd = scroller({ top: 194.84, height: 1094, client: 898 })
    const atStart = scroller({ top: 0.4, height: 1094, client: 898 })

    expect(canScrollFurther(atEnd, 100)).toBe(false)
    expect(canScrollFurther(atStart, -100)).toBe(false)
  })

  it('is false over something that does not scroll', () => {
    const inside = scroller({ top: 0, height: 200, client: 200 })

    expect(canScrollFurther(inside, 100)).toBe(false)
    expect(canScrollFurther(null, 100)).toBe(false)
  })
})
