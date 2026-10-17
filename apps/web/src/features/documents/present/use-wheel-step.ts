import { useEffect, useEffectEvent, useRef } from 'react'

import {
  advanceGesture,
  canScrollFurther,
  NEW_GESTURE,
  STEP_COOLDOWN_MS,
  wheelPixels,
} from './wheel-step.ts'

/**
 * Steps through the presentation with the scroll wheel (or a trackpad swipe), where nothing under
 * the pointer has room left to scroll. Off while something else has the screen (the go-to overlay).
 */
export function useWheelStep(onStep: (direction: 'next' | 'previous') => void, enabled: boolean) {
  const gesture = useRef(NEW_GESTURE)
  const step = useEffectEvent(onStep)

  // Synchronises with the window's wheel, which a presentation is driven from as it is from the keyboard.
  useEffect(() => {
    if (!enabled) return undefined
    const onWheel = (event: WheelEvent): void => {
      // A turn that was already used, such as zooming a picture in the viewer it opened in, is not ours.
      if (event.defaultPrevented) return
      // A pinch to zoom, or a sideways swipe, is not a turn of the wheel.
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      const travel = wheelPixels(event)
      // The tail of the swipe that just stepped is not a scroll of the slide it arrived at: left to
      // the browser it would carry the new slide away from the end it was meant to start at.
      if (event.timeStamp - gesture.current.steppedAt < STEP_COOLDOWN_MS) {
        event.preventDefault()
        return
      }
      if (canScrollFurther(event.target, travel)) return
      event.preventDefault()
      const moved = advanceGesture(gesture.current, travel, event.timeStamp)
      gesture.current = moved.gesture
      if (moved.step !== undefined) step(moved.step)
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('wheel', onWheel)
    }
  }, [enabled])
}
