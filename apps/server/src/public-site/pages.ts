import type { ExtractedText, PublicNavigationNode } from '@quill/application'
import { publicPageHref } from '@quill/application'
import type { Snippet } from '@quill/search'

import { html, raw, toDocument, type Html } from './html.ts'

/**
 * The middles of the four public pages: a document, the site's index, the
 * search results, and the page that is not there.
 *
 * The shell around them is one template (`templates/page.ts`); these are the
 * parts that differ, kept together because they are the same decision made
 * four ways — what a reader sees in the main region — and kept out of the
 * routes because a route's job is to decide *what to load*, not what the
 * answer looks like.
 */

/**
 * The rendered body, on the reading grid.
 *
 * `renderHtml` wraps a document in one `<article>` so that a body is a
 * complete document wherever it is served, and the reading grid *is* an
 * `<article>` (`Prose` in `packages/ui`): nesting the two would put every
 * block one level below the grid, where `grid-column: wide` means nothing and
 * `.prose > * + *` never applies, so every breakout table would silently snap
 * back to the reading measure (ADR-027). So the wrapper is unwrapped and
 * replaced with the grid, exactly as the reading view does it in the browser.
 */
export function renderDocumentMain(view: {
  readonly collectionName: string
  readonly title: string
  readonly bodyHtml: string
  readonly rules: string
}): Html {
  const body = unwrapArticle(view.bodyHtml)
  return html`<p class="site-eyebrow">${view.collectionName}</p>
    <article class="layout-grid prose" data-rules="${view.rules}">
      ${hasTopHeading(body) ? '' : html`<h1>${view.title}</h1>`} ${raw(body)}
    </article>`
}

/**
 * Whether the body opens with a first-level heading of its own.
 *
 * A page needs exactly one `<h1>`, and almost every document provides it: the
 * title *is* the first heading (ADR-005), so adding another would be two. But
 * a body that starts at `##` would leave the page with no first-level heading
 * at all, under two `<h2>`s belonging to the navigation and the contents — so
 * the document's title is rendered as the `<h1>` in exactly that case.
 *
 * Checked against the rendered HTML rather than the outline, because it is the
 * rendered HTML that the heading has to be missing from.
 */
function hasTopHeading(body: string): boolean {
  return /<h1[\s>]/iu.test(body)
}

const ARTICLE_OPEN = '<article>'
const ARTICLE_CLOSE = '</article>'

/**
 * The blocks inside the renderer's `<article>`, or the whole body when it is
 * not shaped that way — a body from an older render version, say, which stays
 * readable for ever (ADR-033).
 */
export function unwrapArticle(body: string): string {
  const trimmed = body.trim()
  return trimmed.startsWith(ARTICLE_OPEN) && trimmed.endsWith(ARTICLE_CLOSE)
    ? trimmed.slice(ARTICLE_OPEN.length, -ARTICLE_CLOSE.length)
    : body
}

/**
 * The home of a site whose collection has no home document: a list of what is
 * on it.
 *
 * Only the top level, because the nesting is already in the navigation beside
 * it and an index that repeats the whole tree is the navigation twice.
 */
export function renderIndexMain(view: {
  readonly siteSlug: string
  readonly title: string
  readonly navigation: readonly PublicNavigationNode[]
}): Html {
  return html`<article class="layout-grid prose">
    <h1>${view.title}</h1>
    ${
      view.navigation.length === 0
        ? html`<p>Nothing has been published here yet.</p>`
        : html`<ul class="site-index">
            ${view.navigation.map(
              (node) =>
                html`<li>
                  <a href="${publicPageHref(view.siteSlug, node.path)}">${node.title}</a>
                </li>`,
            )}
          </ul>`
    }
  </article>`
}

export interface SearchResultView {
  readonly title: string
  readonly path: string
  readonly snippet: Snippet
}

export function renderSearchMain(view: {
  readonly siteSlug: string
  readonly query: string
  readonly results: readonly SearchResultView[]
}): Html {
  return html`<article class="layout-grid prose">
    <h1>Search</h1>
    <p>
      ${
        view.results.length === 0
          ? html`Nothing matched <strong>${view.query}</strong>.`
          : html`${view.results.length} result${view.results.length === 1 ? '' : 's'} for
              <strong>${view.query}</strong>.`
      }
    </p>
    ${
      view.results.length === 0
        ? ''
        : html`<ul class="site-results">
            ${view.results.map(
              (result) => html`<li>
                <a class="site-result-title" href="${publicPageHref(view.siteSlug, result.path)}"
                  >${result.title}</a
                >
                <p class="site-result-snippet">${renderSnippet(result.snippet)}</p>
              </li>`,
            )}
          </ul>`
    }
  </article>`
}

/**
 * A snippet's matches as `<mark>`.
 *
 * The core gives back character offsets rather than markup precisely so that
 * each surface decides how to show a match (ADR-010), and the text between
 * them is escaped like any other text: a snippet is a stranger's query cutting
 * a window out of a document, which is exactly the shape an injection takes.
 */
export function renderSnippet(snippet: Snippet): Html {
  const pieces: Html[] = []
  let cursor = 0
  for (const range of snippet.ranges) {
    if (range.start < cursor) continue
    pieces.push(html`${snippet.text.slice(cursor, range.start)}`)
    pieces.push(html`<mark>${snippet.text.slice(range.start, range.end)}</mark>`)
    cursor = range.end
  }
  pieces.push(html`${snippet.text.slice(cursor)}`)
  return html`${pieces}`
}

/**
 * The whole page for an address where no site answers at all: an unknown slug,
 * a site that has been taken down, an organisation that no longer publishes,
 * or settings this release cannot read.
 *
 * It is HTML rather than the platform's JSON error shape, because everything
 * else this surface answers with is HTML and a reader meeting a JSON body here
 * would be meeting the application — which is the one thing a public address
 * must never show (`docs/product/surfaces.md`). It carries no site name, no
 * navigation and no stylesheet, because there is no site to take any of them
 * from, and that is also what keeps the four reasons indistinguishable.
 */
export function renderNoSitePage(): string {
  return toDocument(html`<html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Nothing is published here</title>
      <meta name="robots" content="noindex,follow" />
    </head>
    <body>
      <main>
        <h1>Nothing is published here</h1>
        <p>There is no documentation at this address.</p>
      </main>
    </body>
  </html>`)
}

export function renderNotFoundMain(view: { readonly siteSlug: string }): Html {
  return html`<article class="layout-grid prose">
    <h1>That page is not here</h1>
    <p>
      The address may have changed, or the page may never have been published.
      <a href="${publicSiteLink(view.siteSlug)}">Start from the top of the site</a>.
    </p>
  </article>`
}

function publicSiteLink(siteSlug: string): string {
  return `/s/${siteSlug}`
}

/**
 * The description a crawler and a chat client's unfurl show: the document's
 * first paragraph (use case 29).
 *
 * The extracted text is the prose of the document, one block per line, with
 * authoring scaffolding and presenter notes already gone (ADR-031), so the
 * first line is the first paragraph. It is trimmed to a length that survives a
 * search result and an unfurl, cut at a word rather than mid-word, with an
 * ellipsis so a reader can see it was cut.
 */
export const DESCRIPTION_MAX_LENGTH = 200

export function firstParagraph(text: ExtractedText): string | null {
  const paragraph = text.body
    .split('\n')
    .find((line) => line.trim().length > 0)
    ?.trim()
  if (paragraph === undefined || paragraph.length === 0) return null
  if (paragraph.length <= DESCRIPTION_MAX_LENGTH) return paragraph
  const cut = paragraph.slice(0, DESCRIPTION_MAX_LENGTH)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * `Article` structured data (schema.org), for the crawler that wants it.
 *
 * Only what the page already states: the headline, the description, when it
 * was published, and who published it. Nothing is invented for the benefit of
 * a search engine that the page does not say to a reader.
 */
export function articleStructuredData(view: {
  readonly title: string
  readonly description: string | null
  readonly canonical: string
  readonly updatedAt: Date
  readonly organisationName: string
}): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: view.title,
    ...(view.description === null ? {} : { description: view.description }),
    mainEntityOfPage: view.canonical,
    dateModified: view.updatedAt.toISOString(),
    publisher: { '@type': 'Organization', name: view.organisationName },
  })
}
