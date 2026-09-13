import type { NavigationLink, OutlineEntry, PublicNavigationNode } from '@quill/application'
import { publicSiteHref } from '@quill/application'

import { html, raw, toDocument, type Html } from '../html.ts'
import { renderFooter } from './footer.ts'
import { renderNavigation } from './navigation.ts'
import { renderTableOfContents } from './table-of-contents.ts'

/**
 * The public page (ADR-023; `docs/design/canvas/Presenting.dc.html`).
 *
 * One template for every page the site has — the home, a document, the search
 * results, the not-found page — because they are one page with different
 * middles, and because the things that must be true of a public page are true
 * of all four: the content is in the first response with no JavaScript
 * involved, there is no application chrome, there is no sign-in wall, and
 * nothing about the organisation travels beyond what was published
 * (`docs/product/surfaces.md`).
 *
 * What is deliberately here rather than in a route:
 *
 * - **Landmarks.** A `header`, a `nav` for the site's sections, a `main` with
 *   the page in an `article`, a second labelled `nav` for the contents, and a
 *   `footer`; a skip link ahead of all of it (AGENTS.md rule 14).
 * - **The crawler's half of the page** (use case 29): a canonical link, a
 *   description taken from the document's first paragraph, Open Graph tags,
 *   and optional `Article` structured data. There is **no `noindex`** on a
 *   published document, ever — that belongs to share links, which are a
 *   different surface (ADR-011). The search results and the not-found page do
 *   carry one, because neither is a published document and both are addresses
 *   whose text the person following the link chose.
 * - **One stylesheet, addressed by its hash**, preloaded so the first paint
 *   does not wait on discovery, and no inline style anywhere: the CSP is
 *   nonce-based with no `unsafe-inline`, so a style attribute this template
 *   emitted would silently do nothing.
 * - **No executable script at all.** Light and dark follow
 *   `prefers-color-scheme` in the generated theme, so the page needs no toggle
 *   and therefore no code (ADR-028). The one `<script>` is the structured
 *   data, which is `application/ld+json`: a data block, not a script a browser
 *   runs, and deliberately without a nonce. A nonce is minted per response, so
 *   carrying one would mean a `304` handing a reader a fresh nonce for a body
 *   that holds the old one — the page's own identity would change on every
 *   request, and nothing would ever revalidate. With no nonce anywhere on the
 *   page, the `ETag` is simply the page.
 */

export interface PageView {
  readonly siteSlug: string
  /** The organisation's name, which is the site's name (ADR-028). */
  readonly siteName: string
  /** The tenant's configured top links (`publicNavigation`, ADR-034). */
  readonly links: readonly NavigationLink[]
  readonly navigation: readonly PublicNavigationNode[]
  /** The page being shown, so the navigation can mark it; null off a document. */
  readonly currentPath: string | null
  /** What goes in `<title>`; the site's name is appended unless it is the site's name. */
  readonly title: string
  readonly description: string | null
  /** The absolute address this page is authoritative at, or null when it has none. */
  readonly canonical: string | null
  /**
   * A `robots` directive, or null for a page a crawler should treat normally.
   *
   * ADR-023's "never `noindex`" is about *published documents*: a search
   * result page is not one, and neither is a not-found page. Both carry
   * `noindex,follow`, so a crawler reads the links and indexes the pages they
   * lead to without the result page itself becoming an indexable address that
   * anybody can choose the text of.
   */
  readonly robots: string | null
  readonly stylesheetHref: string
  readonly outline: readonly OutlineEntry[]
  /** The middle of the page: an article, an index, results, or an apology. */
  readonly main: Html
  readonly updatedAt: Date | null
  /** `Article` structured data, already serialised, or null. */
  readonly structuredData: string | null
  /** What the search box should already contain. */
  readonly query: string | null
}

export function renderPage(view: PageView): string {
  const title = view.title === view.siteName ? view.title : `${view.title} · ${view.siteName}`
  const searchHref = `${publicSiteHref(view.siteSlug)}/search`
  return toDocument(html`<html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
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
      <header class="site-header">
        <div class="site-header-inner">
          <a class="site-brand" href="${publicSiteHref(view.siteSlug)}">${view.siteName}</a>
          ${
            view.links.length === 0
              ? ''
              : html`<ul class="site-links">
                  ${view.links.map((link) => html`<li><a href="${link.href}">${link.label}</a></li>`)}
                </ul>`
          }
          <form class="site-search" role="search" action="${searchHref}" method="get">
            <label class="visually-hidden" for="site-search-input">Search ${view.siteName}</label>
            <input
              id="site-search-input"
              type="search"
              name="q"
              placeholder="Search the docs"
              value="${view.query ?? ''}"
            />
            <button type="submit">Search</button>
          </form>
        </div>
      </header>
      <div class="site-body">
        ${renderNavigation({
          siteSlug: view.siteSlug,
          nodes: view.navigation,
          currentPath: view.currentPath,
        })}
        <main class="site-main" id="site-main">${view.main}</main>
        ${renderTableOfContents(view.outline)}
      </div>
      ${renderFooter({ organisationName: view.siteName, updatedAt: view.updatedAt })}
    </body>
  </html> `)
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
