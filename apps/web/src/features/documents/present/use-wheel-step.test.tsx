import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useWheelStep } from './use-wheel-step.ts'

/** A turn of the wheel at a place, and whether anything claimed it first. */
function turn(target: EventTarget, claim?: (event: WheelEvent) => void): void {
  const listener = claim ?? (() => undefined)
  target.addEventListener('wheel', (event) => {
    if (event instanceof WheelEvent) listener(event)
  })
  target.dispatchEvent(
    new WheelEvent('wheel', { deltaY: 400, deltaMode: 0, bubbles: true, cancelable: true }),
  )
}

describe('stepping with the wheel', () => {
  it('steps on a turn of the wheel that nothing else wanted', () => {
    const onStep = vi.fn<(direction: 'next' | 'previous') => void>()
    renderHook(() => {
      useWheelStep(onStep, true)
    })

    turn(document.body)

    expect(onStep).toHaveBeenCalledWith('next')
  })

  it('leaves a turn that was already used, such as zooming a picture in its viewer, to what used it', () => {
    const onStep = vi.fn<(direction: 'next' | 'previous') => void>()
    renderHook(() => {
      useWheelStep(onStep, true)
    })
    const stage = document.createElement('div')
    document.body.append(stage)

    turn(stage, (event) => {
      event.preventDefault()
    })

    expect(onStep).not.toHaveBeenCalled()
  })

  it('does not let the tail of a swipe scroll the slide it has just arrived at', () => {
    const onStep = vi.fn<(direction: 'next' | 'previous') => void>()
    renderHook(() => {
      useWheelStep(onStep, true)
    })
    const slide = document.createElement('div')
    slide.style.overflowY = 'auto'
    Object.defineProperty(slide, 'scrollHeight', { value: 3000 })
    Object.defineProperty(slide, 'clientHeight', { value: 800 })
    document.body.append(slide)
    turn(document.body)

    // Still turning, now over a slide that has room to scroll: that would carry it off its top.
    const tail = new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true })
    slide.dispatchEvent(tail)

    expect(onStep).toHaveBeenCalledTimes(1)
    expect(tail.defaultPrevented).toBe(true)
  })
})
