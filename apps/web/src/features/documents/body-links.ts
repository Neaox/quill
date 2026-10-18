/**
 * Following a link inside a rendered body without reloading the application.
 *
 * The body is server HTML mounted outside React (ADR-031), so its anchors are
 * plain `<a href>` elements that the browser would follow with a full page
 * load: the whole application booted again to move from one document to the
 * next. A click on a link into the application is handed to the router
 * instead. Everything a person expects of a link still belongs to the
 * browser: a modifier or middle click opens a tab or a window, a link with a
 * `target` or `download` does what it says, a link to a section of this page
 * scrolls, and a link anywhere else leaves.
 */

/** The parts of the application a body may link to: documents, workspaces, share pages. */
const APPLICATION_PATH = /^\/(?:d|w|share)\//u

/** The in-application address a click should be routed to, or undefined to leave it to the browser. */
export function routedLinkHref(
  event: MouseEvent,
  current: Pick<Location, 'href' | 'origin' | 'pathname' | 'search'>,
): string | undefined {
  if (event.defaultPrevented || event.button !== 0) return undefined
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return undefined
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
  if (!(anchor instanceof HTMLAnchorElement)) return undefined
  if (anchor.hasAttribute('download')) return undefined
  if (anchor.target !== '' && anchor.target !== '_self') return undefined

  const url = new URL(anchor.getAttribute('href') ?? '', current.href)
  if (url.origin !== current.origin || !APPLICATION_PATH.test(url.pathname)) return undefined
  // A section of the page already open is the browser's to scroll to.
  if (url.pathname === current.pathname && url.search === current.search) return undefined
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Routes the clicks on a mounted body's links through the navigate `follow`
 * answers with at the time of the click, returning the undo; while it
 * answers undefined, every link is the browser's. One listener on the
 * article, so a body of a thousand links costs one handler, and links added
 * later — a filled child pages list — are covered too.
 */
export function routeBodyLinks(
  article: HTMLElement,
  follow: () => ((href: string) => void) | undefined,
): () => void {
  const view = article.ownerDocument.defaultView
  const onClick = (event: MouseEvent) => {
    const navigate = follow()
    if (navigate === undefined || view === null) return
    const href = routedLinkHref(event, view.location)
    if (href === undefined) return
    event.preventDefault()
    navigate(href)
  }
  article.addEventListener('click', onClick)
  return () => {
    article.removeEventListener('click', onClick)
  }
}

/** Answers a body's stored references with their reading addresses, leaving out what it cannot. */
export type DocumentLinksLoader = (
  references: readonly string[],
  signal: AbortSignal,
) => Promise<ReadonlyMap<string, string>>

/** A link as a body stores it (ADR-035): `/d/<reference>`, then any query and section. */
const STORED_LINK = /^\/d\/([^/?#]+)([?#].*)?$/u

/**
 * Shows each stored link under its readable address (ADR-035), returning the
 * undo, which cancels a request still on its way.
 *
 * A body stores `/d/<id>`, which survives every rename but tells somebody
 * hovering over it or copying it nothing. Every reference in the body is
 * asked for in one request, and each answer becomes the link's `href` with
 * the query and section it carried. What is not answered — a page this
 * reader may not open, one that is gone, a request that failed — keeps the
 * stored form, which the app's `/d/` route resolves when it is followed.
 */
export function readableBodyLinks(article: HTMLElement, load: DocumentLinksLoader): () => void {
  const stored = [...article.querySelectorAll<HTMLAnchorElement>('a[href^="/d/"]')].flatMap(
    (link) => {
      const [, reference, rest] = STORED_LINK.exec(link.getAttribute('href') ?? '') ?? []
      return reference === undefined ? [] : [{ link, reference, rest: rest ?? '' }]
    },
  )
  if (stored.length === 0) return () => undefined

  const controller = new AbortController()
  load([...new Set(stored.map((each) => each.reference))], controller.signal).then(
    (hrefs) => {
      if (controller.signal.aborted) return
      for (const { link, reference, rest } of stored) {
        const href = hrefs.get(reference)
        if (href !== undefined) link.setAttribute('href', `${href}${rest}`)
      }
    },
    // The stored links still work: the app's route resolves them.
    () => undefined,
  )
  return () => {
    controller.abort()
  }
}
