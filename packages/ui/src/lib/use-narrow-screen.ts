import { useEffect, useState } from 'react'

/** Below the medium breakpoint (`md` in the theme): a phone, held either way. */
const NARROW = '(width < 48rem)'

/**
 * Whether the screen is narrower than the medium breakpoint, following it as
 * the window changes.
 *
 * For what CSS cannot decide alone: which controls a page offers in its bar
 * and which it folds into the overflow menu, and whether the page behind the
 * phone's tree sheet is out of reach. Layout itself stays in the stylesheet.
 */
export function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof globalThis.matchMedia === 'function' && globalThis.matchMedia(NARROW).matches,
  )
  // Follows the media query — the external system — as the window changes.
  useEffect(() => {
    if (typeof globalThis.matchMedia !== 'function') return undefined
    const query = globalThis.matchMedia(NARROW)
    const follow = () => {
      setNarrow(query.matches)
    }
    follow()
    query.addEventListener('change', follow)
    return () => {
      query.removeEventListener('change', follow)
    }
  }, [])
  return narrow
}
