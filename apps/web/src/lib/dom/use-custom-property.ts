import { useCallback } from 'react'

/**
 * A ref that writes one CSS custom property onto its element, for a colour
 * that is data rather than a token: a swatch, a slider's track.
 *
 * Not a `style` prop, because the Content-Security-Policy is nonce-based with
 * no `unsafe-inline` (ADR-011) and an inline `style` attribute is what it
 * refuses; the CSSOM is not an attribute, so `setProperty` is allowed — the
 * same reasoning `ThemePreview` gives for its panes.
 *
 * A ref callback with a cleanup (React 19) rather than an effect: it runs when
 * the element or the value changes and removes what it wrote before the next
 * run, so the element is kept in step without a render in between.
 */
export function useCustomProperty(
  name: `--${string}`,
  value: string,
): (element: HTMLElement | null) => (() => void) | undefined {
  return useCallback(
    (element: HTMLElement | null) => {
      if (element === null) return undefined
      element.style.setProperty(name, value)
      return () => {
        element.style.removeProperty(name)
      }
    },
    [name, value],
  )
}
