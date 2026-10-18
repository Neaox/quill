import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

import { peekTarget } from './peek-target.ts'

/** Long enough that moving the pointer across a paragraph opens nothing. */
export const PEEK_OPEN_DELAY_MS = 400
/** Long enough to cross the gap between the link and its card. */
export const PEEK_CLOSE_DELAY_MS = 150

export interface LinkPeekControls {
  /** The link whose card is open, or null. */
  readonly anchor: HTMLAnchorElement | null
  /** The pointer is on the card: keep it. */
  readonly hold: () => void
  /** The pointer has left the card. */
  readonly release: () => void
}

/**
 * Which link in `host` has a peek open (ADR-042, WCAG 1.4.13).
 *
 * A link opens one after the pointer has rested on it, or focus has been on it,
 * for a moment; it closes shortly after the pointer or focus leaves, and at once
 * on Escape or when the page scrolls. It stays open while the pointer is over the
 * card, so a reader can move onto it, and it never takes focus. A touch has no
 * resting pointer, so it opens nothing: the link is just a link.
 *
 * The listeners are on the host and not on each link, because the body's links
 * are put there by the renderer, replaced whenever the document is, and never
 * known to React.
 */
export function useLinkPeek(
  host: RefObject<HTMLElement | null>,
  enabled: boolean,
): LinkPeekControls {
  const [anchor, setAnchor] = useState<HTMLAnchorElement | null>(null)
  const timers = useRef<{ open: number | undefined; close: number | undefined }>({
    open: undefined,
    close: undefined,
  })
  const holdRef = useRef<() => void>(() => undefined)
  const releaseRef = useRef<() => void>(() => undefined)

  // Synchronises the open peek with pointer, focus and keyboard events on the
  // body the renderer put in the DOM: an external system React does not render.
  useEffect(() => {
    const element = host.current
    if (!enabled || element === null) return undefined
    const pending = timers.current
    const shown: { current: HTMLAnchorElement | null } = { current: null }

    const cancel = () => {
      window.clearTimeout(pending.open)
      window.clearTimeout(pending.close)
    }
    const show = (next: HTMLAnchorElement | null) => {
      shown.current = next
      setAnchor(next)
    }
    const arm = (link: HTMLAnchorElement) => {
      cancel()
      if (shown.current === link) return
      pending.open = window.setTimeout(() => show(link), PEEK_OPEN_DELAY_MS)
    }
    const leave = () => {
      cancel()
      if (shown.current === null) return
      pending.close = window.setTimeout(() => show(null), PEEK_CLOSE_DELAY_MS)
    }
    const dismiss = () => {
      cancel()
      show(null)
    }

    const enter = (event: Event) => {
      const link = peekTarget(event.target, element)
      if (link !== null) arm(link)
    }
    const exit = (event: Event & { readonly relatedTarget: EventTarget | null }) => {
      const link = peekTarget(event.target, element)
      if (link === null || peekTarget(event.relatedTarget, element) === link) return
      leave()
    }
    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') enter(event)
    }
    const onPointerOut = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') exit(event)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && shown.current !== null) dismiss()
    }

    holdRef.current = () => window.clearTimeout(pending.close)
    releaseRef.current = leave
    element.addEventListener('pointerover', onPointerOver)
    element.addEventListener('pointerout', onPointerOut)
    element.addEventListener('focusin', enter)
    element.addEventListener('focusout', exit)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', dismiss, { capture: true, passive: true })
    window.addEventListener('resize', dismiss)
    return () => {
      cancel()
      element.removeEventListener('pointerover', onPointerOver)
      element.removeEventListener('pointerout', onPointerOut)
      element.removeEventListener('focusin', enter)
      element.removeEventListener('focusout', exit)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', dismiss, { capture: true })
      window.removeEventListener('resize', dismiss)
    }
  }, [host, enabled])

  return {
    anchor: enabled ? anchor : null,
    hold: () => holdRef.current(),
    release: () => releaseRef.current(),
  }
}
