import type { PublicNavigationNode } from '@quill/application'
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
 *
 * Above the title goes an eyebrow naming the collection, in the grid's
 * content column so it lines up with the title it belongs to — unless the
 * author already wrote one (`hasAuthoredEyebrow`).
 */
export function renderDocumentMain(view: {
  readonly collectionName: string
  readonly title: string
  readonly bodyHtml: string
  readonly rules: string
}): Html {
  const body = unwrapArticle(view.bodyHtml)
  const eyebrow = hasAuthoredEyebrow(body)
    ? ''
    : html`<p class="site-eyebrow">${view.collectionName}</p>`
  return html`<article class="layout-grid prose" data-rules="${view.rules}">
    ${eyebrow} ${hasTopHeading(body) ? '' : html`<h1>${view.title}</h1>`} ${raw(body)}
  </article>`
}

/**
 * Whether the body opens with a paragraph and then its title.
 *
 * That paragraph is the author's own eyebrow — `prose.css` styles a short
 * paragraph immediately before the `<h1>` as one — and the page must not stack
 * a second above it. Only at the very start of the body: a paragraph before a
 * later `<h1>` is ordinary prose. A paragraph cannot contain another, so the
 * first `</p>` closes the one that opened the body.
 */
function hasAuthoredEyebrow(body: string): boolean {
  return /^\s*<p[\s>][\s\S]*?<\/p>\s*<h1[\s>]/iu.test(body)
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

export interface BotPageView {
  readonly userAgent: string
  readonly instanceName: string
  readonly limits: {
    readonly timeoutSeconds: number
    readonly maxRedirects: number
    readonly pageKiB: number
    readonly imageMiB: number
  }
  /** The most requests to one host in a burst, and the steady rate after it, per second. */
  readonly perHost: { readonly burst: number; readonly perSecond: number }
}

/**
 * The page the bot's user agent points at (ADR-042): what Quill fetches when
 * somebody pastes a link, and how a site owner can stop it.
 *
 * Written for the person who found the name in their server log, and so about
 * what they will want to know: why, how much, how often, what for, and how to
 * make it stop. Every number is taken from where it is enforced, so the page
 * cannot promise more than the client does.
 */
export function renderBotPage(view: BotPageView): string {
  const { limits, perHost } = view
  return toDocument(html`<html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${view.instanceName} link preview bot</title>
      <meta name="robots" content="noindex,follow" />
    </head>
    <body>
      <main>
        <h1>The ${view.instanceName} link preview bot</h1>
        <p>
          This is the page named in the user agent
          <code>${view.userAgent}</code>. A request with that user agent came from a documentation
          server (${view.instanceName}) because one of its members pasted a link to your site into a
          document, and the server was making a small card to show for it: the page title, a short
          description, and a picture.
        </p>

        <h2>What it fetches</h2>
        <ul>
          <li>
            The top of one page: the head of the HTML, at most ${String(limits.pageKiB)} KiB,
            stopping at the end of the head. Once for each link, then again at most every few days
            while the link is still being read.
          </li>
          <li>
            If the page names one, its social card image and its icon, at most
            ${String(limits.imageMiB)} MiB each. These are re-encoded and stored; they are never
            shown from your address.
          </li>
          <li>
            If your site is a known embed provider, or the page advertises one, its oEmbed JSON.
          </li>
          <li>
            If the address is a file (a PDF, a video, a document, a picture), only the response
            headers: its type, its size and its name. None of the file is downloaded. For a
            picture, a small thumbnail is also fetched and stored, within the same size limit.
          </li>
        </ul>

        <h2>What it does not do</h2>
        <ul>
          <li>It does not crawl. It follows no links on your page and fetches nothing else.</li>
          <li>
            It does not run scripts, send cookies, sign in, or send a referrer, and it never asks
            for anything that needs a credential.
          </li>
          <li>
            It does not read <code>robots.txt</code>. A preview is a single fetch made for a person
            who chose to share your link, not a crawl, in the same way as when a chat application
            shows a link you paste into it.
          </li>
          <li>
            It does not reach private addresses, other ports than 80 and 443, or addresses behind
            more than ${String(limits.maxRedirects)} redirects.
          </li>
        </ul>

        <h2>How often</h2>
        <p>
          To any one host, a burst of at most ${String(perHost.burst)} requests and then no more
          than one every ${String(1 / perHost.perSecond)} seconds. A request gives up after
          ${String(limits.timeoutSeconds)} seconds.
        </p>

        <h2>To stop it</h2>
        <p>
          Answer requests with this user agent with <code>403</code>, <code>404</code> or
          <code>410</code>. The failure is remembered for an hour, so it will not ask again soon,
          and the people sharing your link will see a plain link. To have it stopped for a whole
          site, or to ask a question, contact whoever runs ${view.instanceName}.
        </p>
      </main>
    </body>
  </html>`)
}

/**
 * The reader preview's answer when there is nothing it may show: a document
 * that is not there, or one the member may not read.
 *
 * One page for both, with nothing taken from the document, so a member cannot
 * tell a document they are kept out of from one that does not exist — the
 * same rule every share-link refusal follows (ADR-011). No stylesheet, like
 * `renderNoSitePage`, because the theme is part of what would be shown.
 */
export function renderNoPreviewPage(): string {
  return toDocument(html`<html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Nothing to preview</title>
      <meta name="robots" content="noindex,nofollow" />
    </head>
    <body>
      <main>
        <h1>Nothing to preview</h1>
        <p>This document does not exist, or you do not have access to it.</p>
      </main>
    </body>
  </html>`)
}

/** The middle of a preview of a document that has no published revision yet. */
export function renderUnpublishedMain(view: {
  readonly collectionName: string
  readonly title: string
}): Html {
  return html`<article class="layout-grid prose">
    <p class="site-eyebrow">${view.collectionName}</p>
    <h1>${view.title}</h1>
    <p>
      Nothing has been published yet. Readers see the latest published revision, so publish this
      document to preview it here.
    </p>
  </article>`
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

// The description helper lives with the use cases, which link cards use too (ADR-042).
export { DESCRIPTION_MAX_LENGTH, firstParagraph } from '@quill/application'

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
