import type { ResolvedMenuLink, ResolvedPublicMenu } from '@quill/application'

import { EMPTY_HTML, html, type Html } from '../html.ts'

/**
 * The public site's header menu: the organisation's standalone links and
 * dropdowns (`resolvePublicMenu`; `docs/architecture/public-site.md`).
 *
 * Rendered twice from one view, because a wide screen and a narrow one want
 * different furniture and CSS shows exactly one of them, so a reader and a
 * screen reader only ever meet one:
 *
 * - **the bar**: a labelled `nav` of links, where a dropdown is a `details`
 *   whose `summary` is the trigger and whose panel is a list of links;
 * - **the compact menu**: one `details` behind a Menu button, holding every
 *   link, each dropdown a labelled group of its own.
 *
 * Both are `details` because a `details` opens and closes with no script, by
 * pointer and by keyboard, and exposes its expanded state to assistive
 * technology natively. The page's one script adds what a disclosure in a bar
 * is expected to do on top (`scheme-script.ts`): Escape closes it and returns
 * focus to its trigger, a click or focus elsewhere closes it, and opening one
 * closes the others. A dropdown is a disclosure of links, not an ARIA `menu`,
 * which would promise arrow-key behaviour and an application role that a
 * list of links on a page should not have.
 *
 * Everything here is text an administrator typed or a title a member wrote,
 * so it goes through the `html` tag and is escaped like everything else; the
 * addresses were held to the menu's whitelist when the settings were saved
 * (`PUBLIC_MENU_URL_PATTERN`, ADR-011), and an external one carries the
 * `rel` that {@link externalLinkRel} gives it.
 */

export interface HeaderMenuView {
  readonly menu: ResolvedPublicMenu
  /** The address of the page being rendered, or null when it has none of its own. */
  readonly currentHref: string | null
  /** Who the page is for, which decides what an external link may tell its destination. */
  readonly audience: PageAudience
}

/**
 * `public`: a published page anybody may read. `private`: a page whose own
 * address is a secret or a member's — the reader preview, a share page.
 */
export type PageAudience = 'public' | 'private'

/**
 * The `rel` of an external link, and the one place it is decided (ADR-011,
 * amended 2026-10-11).
 *
 * - **`noopener` always**, whether or not anything opens a new tab: the
 *   destination never gets a handle on this page.
 * - **`noreferrer` unless** the page is public *and* an administrator said the
 *   destination may know where its readers came from. Even then it learns
 *   only this site's origin: `Referrer-Policy: strict-origin-when-cross-origin`
 *   on every public response is the ceiling, and no link here carries a
 *   `referrerpolicy` that could widen it. A private page's own address — a
 *   preview's, a share token — is never sent, whatever the link says.
 */
export function externalLinkRel(
  referrer: ResolvedMenuLink['referrer'],
  audience: PageAudience,
): string {
  return audience === 'public' && referrer === 'sent' ? 'noopener' : 'noopener noreferrer'
}

const CHEVRON = html`<svg
  class="site-dropdown-chevron"
  viewBox="0 0 12 12"
  width="12"
  height="12"
  aria-hidden="true"
  focusable="false"
>
  <path
    d="M3 4.5L6 7.5L9 4.5"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>`

const EXTERNAL = html`<svg
    class="site-external-icon"
    viewBox="0 0 12 12"
    width="10"
    height="10"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M4.5 2.5h5v5M9.5 2.5L3 9"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    /></svg
  ><span class="visually-hidden"> (external)</span>`

const MENU_ICON = html`<svg
  class="site-compact-icon"
  viewBox="0 0 16 16"
  width="16"
  height="16"
  aria-hidden="true"
  focusable="false"
>
  <path
    d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
  />
</svg>`

type Currency = 'page' | 'section' | null

/**
 * Whether a link is the page being read (`page`), or the site that page is on
 * (`section`). A site's address is a prefix of every page on it, so a link to
 * the site stays marked while a reader moves around inside it.
 */
function currencyOf(link: ResolvedMenuLink, currentHref: string | null): Currency {
  if (currentHref === null || link.external) return null
  if (link.href === currentHref) return 'page'
  return currentHref.startsWith(`${link.href}/`) ? 'section' : null
}

function renderLink(link: ResolvedMenuLink, view: HeaderMenuView, className: string): Html {
  if (link.external) {
    return html`<a
      class="${className}"
      href="${link.href}"
      rel="${externalLinkRel(link.referrer, view.audience)}"
      >${link.label}${EXTERNAL}</a
    >`
  }
  const currency = currencyOf(link, view.currentHref)
  const attributes =
    currency === null
      ? html`class="${className}" href="${link.href}"`
      : html`class="${className}" href="${link.href}"
        aria-current="${currency === 'page' ? 'page' : 'true'}"`
  return html`<a ${attributes}>${link.label}</a>`
}

export function renderHeaderMenu(view: HeaderMenuView): Html {
  if (view.menu.length === 0) return EMPTY_HTML
  const { currentHref } = view

  const bar = view.menu.map((item, index) => {
    if (item.kind === 'link') {
      return html`<li>${renderLink(item.link, view, 'site-bar-link')}</li>`
    }
    const holdsCurrent = item.links.some((link) => currencyOf(link, currentHref) !== null)
    return html`<li>
      <details class="site-dropdown" data-current="${holdsCurrent ? 'true' : 'false'}">
        <summary class="site-bar-link" id="site-dropdown-${index}">${item.label}${CHEVRON}</summary>
        <ul class="site-dropdown-panel" aria-labelledby="site-dropdown-${index}">
          ${item.links.map((link) => html`<li>${renderLink(link, view, 'site-dropdown-link')}</li>`)}
        </ul>
      </details>
    </li>`
  })

  const compact = view.menu.map((item, index) => {
    if (item.kind === 'link') {
      return html`<li>${renderLink(item.link, view, 'site-compact-link')}</li>`
    }
    return html`<li>
      <p class="site-compact-heading" id="site-compact-group-${index}">${item.label}</p>
      <ul role="group" aria-labelledby="site-compact-group-${index}">
        ${item.links.map((link) => html`<li>${renderLink(link, view, 'site-compact-link')}</li>`)}
      </ul>
    </li>`
  })

  return html`<nav class="site-bar" aria-label="Site">
      <ul>
        ${bar}
      </ul>
    </nav>
    <details class="site-compact">
      <summary class="site-compact-toggle">${MENU_ICON}<span>Menu</span></summary>
      <nav class="site-compact-panel" aria-label="Site">
        <ul>
          ${compact}
        </ul>
      </nav>
    </details>`
}
