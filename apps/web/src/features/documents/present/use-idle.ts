import { useEffect, useState } from 'react'

/** Everything that counts as the room still being with us. */
const ACTIVITY = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const

/**
 * Whether nothing has happened for a while.
 *
 * The presenter bar fades when a presentation is idle and comes back on
 * pointer movement or a key (quill-plan.md section 14). That is a fact about
 * the window's input rather than about React's tree, so it is an effect
 * subscribing to the window — and the timer is restarted from the listener
 * rather than by re-running the effect, so a presenter waving the mouse costs
 * one `clearTimeout` a frame instead of a subscribe-and-unsubscribe cycle.
 */
export function useIdle(afterMs: number): boolean {
  const [idle, setIdle] = useState(false)

  /* Synchronises with the window's pointer and keyboard, which is the only
     place "the room has been still for a moment" can be observed. */
  useEffect(() => {
    let timer = 0
    const sleep = (): void => {
      timer = window.setTimeout(() => setIdle(true), afterMs)
    }
    const wake = (): void => {
      window.clearTimeout(timer)
      setIdle(false)
      sleep()
    }

    sleep()
    for (const event of ACTIVITY) window.addEventListener(event, wake, { passive: true })
    return () => {
      window.clearTimeout(timer)
      for (const event of ACTIVITY) window.removeEventListener(event, wake)
    }
  }, [afterMs])

  return idle
}
