/**
 * A ref callback that writes CSS custom properties onto an element and
 * removes exactly those again when React detaches it or swaps the callback.
 *
 * This is how a settings surface paints with colours that exist only as data
 * — a theme being edited, a doctor's specimen — rather than as tokens on the
 * page. A custom property set through the CSSOM needs no `unsafe-inline` in
 * the Content-Security-Policy (ADR-011), and it cascades to the element's
 * subtree and nothing else, so the semantic utilities beneath it (`bg-surface`,
 * `text-(--specimen-fg)`) resolve to the painted values.
 *
 * Values are not sanitised and need not be: a custom property is not a rule,
 * the CSSOM drops what it cannot parse, and nothing written to one property
 * reaches another declaration, a selector or a URL.
 */
export function paintProperties(properties: Readonly<Record<string, string>>) {
  return (element: HTMLElement | null) => {
    if (element === null) return undefined
    const written = Object.entries(properties)
    for (const [name, value] of written) element.style.setProperty(name, value)
    return () => {
      for (const [name] of written) element.style.removeProperty(name)
    }
  }
}
