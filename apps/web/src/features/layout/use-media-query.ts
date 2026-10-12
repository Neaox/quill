import { useSyncExternalStore } from 'react'

/**
 * Whether the window matches a media query, kept in step as it changes.
 *
 * For the few places where a phone and a desktop get a *different surface*
 * rather than the same one reflowed — a bar and a sheet instead of a column
 * beside the form — so the markup that is not shown is not rendered either
 * (two Save buttons in the tree, one of them hidden, would be two Save
 * buttons to a screen reader's rotor). Everything that is merely a reflow is
 * a Tailwind variant, not this.
 *
 * `useSyncExternalStore` because the viewport is an external system the
 * component subscribes to, which is what that hook is for (AGENTS.md rule 6).
 * Where `matchMedia` is missing — Node, jsdom — the query reads as not
 * matching, so the default, wide surface renders; the same
 * try-the-real-thing shape `prefersReducedMotion` uses in `@quill/ui`.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = mediaQueryList(query)
      list?.addEventListener('change', onChange)
      return () => list?.removeEventListener('change', onChange)
    },
    () => mediaQueryList(query)?.matches ?? false,
    () => false,
  )
}

function mediaQueryList(query: string): MediaQueryList | undefined {
  try {
    return window.matchMedia(query)
  } catch {
    return undefined
  }
}

/**
 * Below Tailwind's `xl` breakpoint, where a settings editor's preview no
 * longer fits beside its controls and moves into a sheet behind a bar. Stated
 * once so the bar and the columns cannot disagree about where the line is.
 */
export const COMPACT_EDITOR_QUERY = '(width < 80rem)'

/**
 * Where a control's targets grow to 44 pixels, the smallest WCAG 2.5.5
 * accepts: a coarse pointer at any width, or a phone-sized window below
 * Tailwind's `md`. Decided by the input, not the window alone, so a tablet
 * with a mouse keeps the desktop's sizes.
 */
export const TOUCH_TARGET_QUERY = '(pointer: coarse), (width < 48rem)'
