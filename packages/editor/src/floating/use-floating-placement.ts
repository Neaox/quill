import { useEffect, useEffectEvent, useLayoutEffect } from 'react'
import type { RefObject } from 'react'

import { place } from './placement.ts'
import type { PlacementRequest, Rect } from './placement.ts'

/**
 * Keeps a `position: fixed` popup beside a rectangle in the document.
 *
 * The popup's coordinates are written to the element rather than held in React
 * state: they are a measurement of the browser's layout, they change on every
 * scroll, and a state update per scroll event would re-render the menu to say
 * what the DOM can be told directly. This is the one place that synchronises
 * with that external system, and it does so before paint so a popup never
 * appears at the top corner for a frame.
 *
 * The caller owns the ref, because the same element is usually wanted for other
 * things too (focus, measurement). `locate` is read on every render and on every
 * scroll or resize, so it may be a plain closure over the editor: it returns where the anchor is *now*, which is
 * what makes a menu follow a caret that the page scrolls away from.
 */

export type Locate = () => Rect | null

export type FloatingOptions = Pick<
  PlacementRequest,
  'prefer' | 'align' | 'gap' | 'margin' | 'limit'
>

/** The element's height as it would be with no limit, which is what `place` decides on. */
function naturalSize(element: HTMLElement): { width: number; height: number } {
  const frame = element.offsetHeight - element.clientHeight
  return { width: element.offsetWidth, height: element.scrollHeight + frame }
}

function applyPlacement(element: HTMLElement, locate: Locate, options: FloatingOptions): void {
  const anchor = locate()
  if (anchor === null) return
  const placement = place({
    anchor,
    size: naturalSize(element),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    ...options,
  })
  element.style.top = `${String(placement.top)}px`
  element.style.left = `${String(placement.left)}px`
  element.style.maxHeight = `${String(placement.maxHeight)}px`
  element.dataset['side'] = placement.side
}

export function useFloatingPlacement(
  element: RefObject<HTMLElement | null>,
  active: boolean,
  locate: Locate,
  options: FloatingOptions = {},
): void {
  // An Effect Event: always the newest `locate` and `options`, without the
  // listeners below having to be torn down and rebuilt whenever either changes.
  const follow = useEffectEvent(() => {
    if (element.current !== null) applyPlacement(element.current, locate, options)
  })

  // After every render, because what changed may be the anchor (the caret moved
  // as the author typed) or the popup's own size (the list got shorter).
  useLayoutEffect(() => {
    if (active) follow()
  })

  // Subscribes to the browser's scroll, resize and layout changes, which happen
  // outside React, for as long as the popup is showing.
  useEffect(() => {
    const target = element.current
    if (!active || target === null) return undefined
    const reposition = (): void => {
      follow()
    }
    // Capture: a scroll in any ancestor container moves the anchor, and scroll
    // does not bubble.
    window.addEventListener('scroll', reposition, { capture: true, passive: true })
    window.addEventListener('resize', reposition)
    const observer = new ResizeObserver(reposition)
    observer.observe(target)
    return () => {
      window.removeEventListener('scroll', reposition, { capture: true })
      window.removeEventListener('resize', reposition)
      observer.disconnect()
    }
  }, [element, active])
}
