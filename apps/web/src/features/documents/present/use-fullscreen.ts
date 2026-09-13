import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * What a surface can do with the Fullscreen API, and what happens when it
 * cannot.
 *
 * Full screen is requested once, when the presentation opens, because that is
 * what a presenter asked for by opening it. Browsers grant the request only
 * from a user gesture — arriving by pressing Present carries one, a link
 * opened cold does not — and a policy or a kiosk may refuse it outright, so a
 * refusal is not an error: the presentation runs windowed, and the presenter
 * bar keeps offering the control, which *is* a gesture and therefore does
 * work. Nothing about the layout depends on which of the two happened.
 *
 * The document element is what goes full screen, not the surface's own `div`.
 * The two look identical, because the surface already fills the viewport, and
 * the document element is a stable target that needs no ref: a hook that read
 * one would have to be memoised against `ref.current`, which React cannot
 * track.
 */
export interface Fullscreen {
  /** Whether this browser has the API at all; where it does not, no control is offered. */
  readonly supported: boolean
  readonly active: boolean
  readonly request: () => void
  readonly exit: () => void
}

export interface FullscreenOptions {
  /**
   * Called when full screen ends and this surface still wanted it — the
   * browser's own Escape, or F11.
   *
   * It exists because the first Escape inside full screen belongs to the
   * browser, and the engines disagree about what the page hears afterwards:
   * Chromium still dispatches the `keydown`, while Firefox and WebKit swallow
   * it entirely. A surface whose Escape means something — a presentation's
   * means "leave" — would answer the key on one engine and ignore it on two,
   * so it listens for the exit instead, which every engine reports.
   */
  readonly onBrowserExit?: (() => void) | undefined
}

/**
 * How long an exit has to last before it counts as one.
 *
 * `fullscreenchange` is not delivered in step with the calls that cause it:
 * WebKit resolves `requestFullscreen` before firing the event, repeats the
 * event, and reorders it against an `exitFullscreen` issued in the same tick
 * — which React does on every mount in development, where an effect that
 * asks for full screen and gives it back runs twice. Pairing events with
 * calls therefore cannot work; what settles the question is the state a
 * moment later. An exit the presenter caused stays exited; the churn is back
 * in full screen within a frame or two.
 */
const EXIT_SETTLES_MS = 300

function isFullscreen(): boolean {
  return globalThis.document.fullscreenElement != null
}

export function useFullscreen({ onBrowserExit }: FullscreenOptions = {}): Fullscreen {
  const [active, setActive] = useState(false)
  const supported = typeof globalThis.document.exitFullscreen === 'function'

  // What this surface currently wants, rather than what it last called: the
  // two come apart exactly when a browser answers late. Refs, not state: both
  // are read inside an event handler, and nothing renders from either.
  const wanted = useRef(false)
  const wasActive = useRef(false)

  // The request is asynchronous, and leaving the surface before it resolves
  // must still give the screen back — otherwise the presenter arrives at the
  // reading view with the browser still full screen and nothing on the page
  // saying why. Chaining every call keeps them in the order they were made.
  const settled = useRef<Promise<void>>(Promise.resolve())

  const request = useCallback(() => {
    wanted.current = true
    settled.current = settled.current.then(async () => {
      const call = globalThis.document.documentElement.requestFullscreen?.()
      // A swallowed rejection: a refused request is a state this surface
      // supports, not a failure anyone needs to be told about. It is also the
      // ordinary answer to a presentation opened from a pasted link, which
      // carries no gesture for the browser to act on.
      if (call === undefined) {
        wanted.current = false
        return
      }
      await call.catch(() => {
        wanted.current = false
      })
    })
  }, [])

  const exit = useCallback(() => {
    wanted.current = false
    settled.current = settled.current.then(async () => {
      if (!isFullscreen()) return
      // Read as the optional platform call it is, like the request above: by
      // the time this runs the surface has usually gone, and what is left of
      // the page is not this hook's to assume.
      await globalThis.document.exitFullscreen?.().catch(() => {})
    })
  }, [])

  /* Synchronises with the browser's full-screen state, which changes without
     us: Escape, F11, and the window manager all leave it. Resubscribed when
     the caller's handler changes — a presentation leaves *at the section on
     screen*, so its handler changes with the step — which costs one listener
     swap per step and nothing else. */
  useEffect(() => {
    let settling = 0
    const onChange = (): void => {
      const now = isFullscreen()
      const was = wasActive.current
      wasActive.current = now
      setActive(now)

      // Any further change restarts the question, so a burst of them is read
      // as whatever it ends on rather than as each of its steps.
      window.clearTimeout(settling)
      if (now || !was || !wanted.current) return
      settling = window.setTimeout(() => {
        if (!isFullscreen() && wanted.current) onBrowserExit?.()
      }, EXIT_SETTLES_MS)
    }
    globalThis.document.addEventListener('fullscreenchange', onChange)
    return () => {
      window.clearTimeout(settling)
      globalThis.document.removeEventListener('fullscreenchange', onChange)
    }
  }, [onBrowserExit])

  /* Synchronises with the Fullscreen API itself: opening a presentation is
     the request, and leaving it gives the screen back. */
  useEffect(() => {
    if (!supported) return undefined
    request()
    return exit
  }, [supported, request, exit])

  return { supported, active, request, exit }
}
