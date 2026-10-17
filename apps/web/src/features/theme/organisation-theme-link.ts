/**
 * The organisation's theme, applied to the page (ADR-028, "Delivery").
 *
 * Three things change together: the `<link>` to the stylesheet the server
 * generated from the organisation's theme, `data-theme-id` on `<html>`, which
 * is the identity that stylesheet's palette is scoped to, and the layout
 * attributes the stylesheet reads from `<html>` (`data-rules`, `data-align`;
 * whatever the server names, so a new axis needs nothing here). The bundle
 * already carries every built-in identity, so until the sheet arrives the page
 * is the built-in it names, never unstyled; once it has, the sheet wins by one
 * selector's specificity (`apps/server/src/theme/theme-stylesheet.ts`).
 *
 * **No flash on a change.** A saved theme is a new address. The new sheet is
 * linked beside the old one, and the old one comes off — and the identity
 * moves — only when the new one has loaded, so a screen re-themes in one step
 * rather than passing through the built-in on the way. A sheet that fails to
 * load is taken back off and the page keeps the theme it had.
 *
 * Plain DOM, owned by one component at the application's root; this module is
 * the whole of what it does to the document, so it can be tested without one.
 */

export interface OrganisationTheme {
  /** The value for `data-theme-id`. */
  readonly themeId: string
  readonly stylesheetHref: string
  /** Layout attributes for `<html>`, such as `{ 'data-rules': 'plain' }`. */
  readonly attributes: Readonly<Record<string, string>>
}

export interface OrganisationThemeLink {
  apply(theme: OrganisationTheme): void
  /** Takes the sheet and the identity back off the page. */
  dispose(): void
}

const MARKER = 'data-organisation-theme'
const IDENTITY = 'data-theme-id'
/** Only `data-` attributes, so a summary can never set an event handler or a `style`. */
const LAYOUT_ATTRIBUTE = /^data-[a-z]+$/u

export function createOrganisationThemeLink(page: Document): OrganisationThemeLink {
  let current: HTMLLinkElement | null = null
  let pending: HTMLLinkElement | null = null
  let written: readonly string[] = []

  /** The identity and the layout attributes, replacing whatever this wrote before. */
  const writeAttributes = ({ themeId, attributes }: OrganisationTheme) => {
    const root = page.documentElement
    const names = Object.keys(attributes).filter((name) => LAYOUT_ATTRIBUTE.test(name))
    for (const name of written) if (!names.includes(name)) root.removeAttribute(name)
    for (const name of names) root.setAttribute(name, attributes[name] ?? '')
    root.setAttribute(IDENTITY, themeId)
    written = names
  }

  const settle = (link: HTMLLinkElement, theme: OrganisationTheme) => {
    if (pending !== link) return
    current?.remove()
    current = link
    pending = null
    writeAttributes(theme)
  }

  const abandon = (link: HTMLLinkElement) => {
    if (pending !== link) return
    link.remove()
    pending = null
  }

  return {
    apply(theme) {
      const { stylesheetHref } = theme
      if (pending?.getAttribute('href') === stylesheetHref) return
      if (pending === null && current?.getAttribute('href') === stylesheetHref) {
        // The same sheet, but the layout may have changed without the theme.
        writeAttributes(theme)
        return
      }

      pending?.remove()
      const link = page.createElement('link')
      link.rel = 'stylesheet'
      link.setAttribute('href', stylesheetHref)
      link.setAttribute(MARKER, '')
      link.addEventListener('load', () => settle(link, theme), { once: true })
      link.addEventListener('error', () => abandon(link), { once: true })
      pending = link
      page.head.append(link)
    },

    dispose() {
      pending?.remove()
      current?.remove()
      pending = null
      current = null
      page.documentElement.removeAttribute(IDENTITY)
      for (const name of written) page.documentElement.removeAttribute(name)
      written = []
    },
  }
}
