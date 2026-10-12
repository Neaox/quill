import type { OutlineEntry, ResolvedPublicMenu } from '@quill/application'

import { html, raw, toDocument, type Html } from '../html.ts'
import { renderFooter } from './footer.ts'
import { renderHeaderMenu, type PageAudience } from './header-menu.ts'
import { renderNavigation, type NavigationSection } from './navigation.ts'
import { renderTableOfContents } from './table-of-contents.ts'

/**
 * The public page (ADR-023; `docs/architecture/public-site.md`).
 *
 * One template for every page the site has — the home, a document, the search
 * results, the not-found page — and for the reader preview, because they are
 * one page with different middles, and because the things that must be true
 * of a public page are true of all of them: the content is in the first
 * response, there is no application chrome, there is no sign-in wall, and
 * nothing about the organisation travels beyond what was published
 * (`docs/product/surfaces.md`). A preview that used a template of its own
 * would be previewing that template.
 *
 * The chrome, in reading order:
 *
 * - **A sticky header** on a translucent page colour with a hairline: the
 *   organisation's lockup on the left, then its menu — links and dropdowns,
 *   folded behind a Menu button on a narrow screen (`header-menu.ts`) — and
 *   the site's search and the reader's colour-scheme switch on the right.
 * - **Three columns**: the documents (one disclosure per collection), the
 *   page, and "On this page". They fold on a narrow screen into one column
 *   with the documents in a disclosure card of their own (`public-site.css`).
 * - **A footer** under the page, outside `main`, where a footer is a landmark.
 *
 * What is deliberately here rather than in a route:
 *
 * - **Landmarks.** A skip link ahead of everything, a `header`, a labelled
 *   `nav` for the documents, a `main`, a second labelled `nav` for the
 *   contents, and a `footer` (AGENTS.md rule 14).
 * - **The crawler's half of the page** (use case 29): a canonical link, a
 *   description, Open Graph tags and optional `Article` structured data. There
 *   is **no `noindex`** on a published document, ever; the search results, the
 *   not-found page and the preview carry one because none of them is.
 * - **One stylesheet and one script, each addressed by its own hash**, and no
 *   inline style or script anywhere: the CSP is strict with no
 *   `unsafe-inline`. The script (`scheme-script.ts`) is a same-origin file in
 *   the head, so it runs before first paint without a nonce — and because no
 *   nonce is on the page, its bytes are its identity and a `304` stays right.
 *   The one inline `<script>` is structured data, which is
 *   `application/ld+json`: a data block, never executed.
 */

export interface PageView {
  /** The organisation's name, which is the site's name (ADR-028). */
  readonly siteName: string
  /** Where the lockup leads, or null when there is no home to go to. */
  readonly homeHref: string | null
  /**
   * The organisation's header menu, already resolved to titles and addresses
   * (`resolvePublicMenu`; `templates/header-menu.ts`).
   */
  readonly menu: ResolvedPublicMenu
  /** This page's own address, so the menu can mark it; null when it has none. */
  readonly currentHref: string | null
  /**
   * `public` for a published page, `private` for the reader preview: a private
   * page's external links never tell their destination where they came from.
   */
  readonly audience: PageAudience
  /** Where the search box submits, or null when there is nothing to search. */
  readonly searchHref: string | null
  readonly sections: readonly NavigationSection[]
  /** What goes in `<title>`; the site's name is appended unless it is the site's name. */
  readonly title: string
  readonly description: string | null
  /** The absolute address this page is authoritative at, or null when it has none. */
  readonly canonical: string | null
  /**
   * A `robots` directive, or null for a page a crawler should treat normally.
   *
   * ADR-023's "never `noindex`" is about *published documents*: a search
   * result page is not one, a not-found page is not one, and a preview is not
   * one.
   */
  readonly robots: string | null
  readonly stylesheetHref: string
  readonly scriptHref: string
  /** The reader — code highlighting and the diagram lightbox (`reader-script.ts`) — loaded as a module. */
  readonly readerHref: string
  /**
   * The theme identity the stylesheet's palette is scoped to, written on
   * `<html>` as `data-theme-id` exactly as the application writes it
   * (ADR-028), so the one theme stylesheet applies the same way on both.
   */
  readonly themeId: string
  /**
   * The layout attributes the stylesheet reads from `<html>` — `data-rules`,
   * `data-align` (`theme/page-attributes.ts`) — exactly as the application
   * writes them. Names are `data-` and a lower-case word; values are escaped.
   */
  readonly htmlAttributes: Readonly<Record<string, string>>
  readonly outline: readonly OutlineEntry[]
  /** The middle of the page: an article, an index, results, or an apology. */
  readonly main: Html
  readonly updatedAt: Date | null
  /** `Article` structured data, already serialised, or null. */
  readonly structuredData: string | null
  /** What the search box should already contain. */
  readonly query: string | null
  /** The reader preview's banner (`preview-banner.ts`), or null on the public site. */
  readonly preview: Html | null
}

/** The word after the organisation's name in the lockup, a tone quieter. */
const EDITION = 'docs'

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * The lockup's mark: the organisation's initial on an accent tile.
 *
 * A stand-in for the logo, which the settings document can name but nothing
 * can serve yet (`settings/documents.ts`). One grapheme rather than one code
 * unit, so a name that starts with an accent or an emoji keeps it whole.
 */
export function lockupMark(name: string): string {
  const [first] = graphemes.segment(name.trim())
  return first === undefined ? '' : first.segment.toLocaleUpperCase()
}

export function renderPage(view: PageView): string {
  const title = view.title === view.siteName ? view.title : `${view.title} · ${view.siteName}`
  const navigation = renderNavigation(view.sections)
  const root = html`lang="en" data-theme-id="${view.themeId}"${htmlAttributes(view.htmlAttributes)}`
  return toDocument(html`<html ${root}>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="color-scheme" content="light dark" />
      <title>${title}</title>
      ${view.robots === null ? '' : html`<meta name="robots" content="${view.robots}" />`}
      ${view.description === null ? '' : html`<meta name="description" content="${view.description}" />`}
      ${view.canonical === null ? '' : html`<link rel="canonical" href="${view.canonical}" />`}
      <meta property="og:type" content="article" />
      <meta property="og:site_name" content="${view.siteName}" />
      <meta property="og:title" content="${view.title}" />
      ${
        view.description === null
          ? ''
          : html`<meta property="og:description" content="${view.description}" />`
      }
      ${view.canonical === null ? '' : html`<meta property="og:url" content="${view.canonical}" />`}
      <meta name="twitter:card" content="summary" />
      <link rel="preload" as="style" href="${view.stylesheetHref}" />
      <link rel="stylesheet" href="${view.stylesheetHref}" />
      <script src="${view.scriptHref}"></script>
      <script type="module" src="${view.readerHref}"></script>
      ${
        view.structuredData === null
          ? ''
          : html`<script type="application/ld+json">
              ${jsonLd(view.structuredData)}
            </script>`
      }
    </head>
    <body>
      <a class="skip-link" href="#site-main">Skip to content</a>
      ${view.preview ?? ''}
      <header class="site-header">
        <div class="site-header-inner">
          ${renderLockup(view)}
          ${renderHeaderMenu({ menu: view.menu, currentHref: view.currentHref, audience: view.audience })}
          <div class="site-tools">
            ${view.searchHref === null ? '' : renderSearch(view.searchHref, view.siteName, view.query)}
            ${SCHEME_SWITCH}
          </div>
        </div>
      </header>
      <div class="site-body">
        ${
          navigation.value === ''
            ? ''
            : html`<div class="site-side">
                <details class="site-menu" open>
                  <summary>Documents</summary>
                  ${navigation}
                </details>
              </div>`
        }
        <main class="site-main" id="site-main">${view.main}</main>
        <div class="site-aside">${renderTableOfContents(view.outline)}</div>
        ${renderFooter({ organisationName: view.siteName, updatedAt: view.updatedAt })}
      </div>
    </body>
  </html> `)
}

function renderLockup(view: PageView): Html {
  const inner = html`<span class="site-mark" aria-hidden="true">${lockupMark(view.siteName)}</span
    ><span class="site-wordmark"
      >${view.siteName} <span class="site-edition">${EDITION}</span></span
    >`
  return view.homeHref === null
    ? html`<span class="site-brand">${inner}</span>`
    : html`<a class="site-brand" href="${view.homeHref}">${inner}</a>`
}

const SEARCH_ICON = html`<svg
  class="site-search-icon"
  viewBox="0 0 16 16"
  width="14"
  height="14"
  aria-hidden="true"
  focusable="false"
>
  <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" />
  <path
    d="M10.5 10.5L14 14"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
  />
</svg>`

/**
 * The site's search: a plain `GET` form, so it works with no script, and a
 * submit button a keyboard reaches even though the design shows only the
 * field — pressing Enter is not the only way a form should be submittable.
 */
function renderSearch(action: string, siteName: string, query: string | null): Html {
  return html`<form class="site-search" role="search" action="${action}" method="get">
    <label class="visually-hidden" for="site-search-input">Search ${siteName}</label>
    ${SEARCH_ICON}
    <input
      id="site-search-input"
      type="search"
      name="q"
      placeholder="Search"
      value="${query ?? ''}"
    />
    <button class="visually-hidden-until-focus" type="submit">Search</button>
  </form>`
}

/**
 * The reader's colour scheme (ADR-028), as a segmented control on a well.
 *
 * `hidden` in the markup: without the script there is nothing to change and
 * the page follows the system, so a control that did nothing would be a lie.
 * The script reveals it and checks the reader's current choice.
 */
const SCHEME_SWITCH = html`<fieldset class="site-scheme" hidden>
  <legend class="visually-hidden">Colour scheme</legend>
  <label><input type="radio" name="site-scheme" value="system" checked /><span>System</span></label>
  <label><input type="radio" name="site-scheme" value="light" /><span>Light</span></label>
  <label><input type="radio" name="site-scheme" value="dark" /><span>Dark</span></label>
</fieldset>`

/** An attribute name may only be `data-` and a word: it is written into the page unescaped. */
const ATTRIBUTE_NAME = /^data-[a-z]+$/u

function htmlAttributes(attributes: Readonly<Record<string, string>>): Html[] {
  return Object.entries(attributes)
    .filter(([name]) => ATTRIBUTE_NAME.test(name))
    .map(([name, value]) => html` ${raw(name)}="${value}"`)
}

/**
 * Structured data, safe inside a `<script>`.
 *
 * `JSON.stringify` will happily produce `</script>` inside a string value — a
 * document titled with one is all it takes — which ends the element early and
 * puts the rest of the JSON on the page as markup. Escaping the `<` as a
 * JSON unicode escape keeps the value identical to every parser and impossible
 * to close the element with.
 */
function jsonLd(serialised: string): Html {
  return raw(serialised.replaceAll('<', '\\u003c').replaceAll('&', '\\u0026'))
}
