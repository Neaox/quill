/**
 * Details on the reading surfaces (ADR-048): what a page does for the
 * browser's own `<details>` once it has loaded.
 *
 * A details already works without this: it opens and closes, it is operated
 * by the keyboard and announced, and where the browser supports it, its find
 * opens the one a match is in. This only covers what a closed section would
 * otherwise hide:
 *
 * - **A link into a closed section opens it.** A heading, a block anchor or
 *   any other target inside a closed details opens every details around it,
 *   on load, when the address changes, and when an in-page link to it is
 *   followed again; then it is scrolled to, which the browser could not do
 *   while it was hidden.
 * - **A text fragment opens the section its text is in** (`#:~:text=`), read
 *   from the address where the browser left it there and from the
 *   navigation entry where it took it off.
 * - **Find opens what it finds**, from `beforematch`, the event a browser
 *   fires before it reveals a match hidden `until-found`.
 * - **An accordion stays exclusive** where the browser does not group
 *   details by `name` itself: opening one closes the others of its name.
 * - **Paper shows everything**: every details is opened for printing, and the
 *   ones it opened are closed again afterwards.
 *
 * Nothing is remembered. Whether a section is open is the document's default
 * and then the reader's click; no store is read or written.
 */

export interface DetailsOptions {
  /**
   * Whether the browser closes the other details of a name itself. Asked of
   * `HTMLDetailsElement` unless given; `fallback` makes this module do it.
   */
  readonly exclusive?: 'native' | 'fallback'
  /** The address the page was navigated to, fragment directive and all, where the browser keeps it. */
  readonly navigationUrl?: () => string | undefined
}

const ID_PREFIX = 'user-content-'

function decode(value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

/**
 * The text each `text=` of a URL's fragment directive starts with: its
 * `textStart`, without the `prefix-` and `-suffix` that only narrow where it
 * is (the URL Fragment Text Directives draft).
 */
export function textFragments(url: string): string[] {
  const at = url.indexOf(':~:')
  if (at === -1) return []
  return url
    .slice(at + 3)
    .split('&')
    .filter((directive) => directive.startsWith('text='))
    .flatMap((directive) => {
      const parts = directive.slice('text='.length).split(',')
      const [start] = parts.filter(
        (part, index) => !(index === 0 && part.endsWith('-') && parts.length > 1),
      )
      /* v8 ignore next -- dropping a prefix leaves at least the start, which `parts.length > 1` guards. */
      const text = start === undefined ? undefined : decode(start)
      return text === undefined || text === '' ? [] : [text]
    })
}

/** Text as a reader's find compares it: case and runs of white space aside. */
function comparable(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim().toLocaleLowerCase()
}

/** Whether `node` is part of the summary of `details`, which shows while it is closed. */
function inSummary(details: HTMLDetailsElement, node: Node): boolean {
  const summary = details.querySelector(':scope > summary')
  return summary !== null && summary.contains(node)
}

/** Opens every closed details around `node`. Whether it opened any. */
function reveal(node: Node): boolean {
  let opened = false
  let details = node.parentElement?.closest('details') ?? null
  while (details !== null) {
    if (!details.open && !inSummary(details, node)) {
      details.open = true
      opened = true
    }
    details = details.parentElement?.closest('details') ?? null
  }
  return opened
}

/** The element a fragment names, inside `root`, by its id or the id the renderer prefixed. */
function targetOf(root: ParentNode, document: Document, hash: string): Element | undefined {
  const id = decode(hash.replace(/^#/u, '').replace(/:~:.*$/su, ''))
  if (id === undefined || id === '') return undefined
  const found = document.getElementById(id) ?? document.getElementById(`${ID_PREFIX}${id}`)
  return found !== null && root.contains(found) ? found : undefined
}

function scrollTo(element: Element): void {
  if (typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'start' })
}

/** Enhances every details in `root`. Returns what takes the enhancement away again. */
export function enhanceDetails(root: ParentNode & Node, options: DetailsOptions = {}): () => void {
  // Only a document has no owner, and a document that is not shown (one made to hold a template)
  // has no window to listen on.
  const view = (root instanceof Document ? root : root.ownerDocument)?.defaultView
  if (view === null || view === undefined) return () => undefined
  const { document } = view

  const all = (): HTMLDetailsElement[] => [...root.querySelectorAll('details')]

  const openTarget = (hash: string): void => {
    const target = targetOf(root, document, hash)
    if (target !== undefined && reveal(target)) scrollTo(target)
  }

  const openFragments = (urls: readonly (string | undefined)[]): void => {
    const wanted = urls
      .flatMap((url) => (url === undefined ? [] : textFragments(url)))
      .map(comparable)
    if (wanted.length === 0) return
    for (const details of all()) {
      const text = comparable(details.textContent)
      if (!details.open && wanted.some((fragment) => text.includes(fragment))) {
        details.open = true
        reveal(details)
      }
    }
  }

  const onHashChange = (): void => {
    openTarget(view.location.hash)
  }

  const onClick = (event: Event): void => {
    const link = event.target instanceof view.Element ? event.target.closest('a[href^="#"]') : null
    const href = link?.getAttribute('href')
    if (href !== null && href !== undefined) openTarget(href)
  }

  const onBeforeMatch = (event: Event): void => {
    /* v8 ignore next -- the root only hears events from nodes below it; this narrows `EventTarget`. */
    if (event.target instanceof view.Node) reveal(event.target)
  }

  const exclusive =
    options.exclusive ?? ('name' in view.HTMLDetailsElement.prototype ? 'native' : 'fallback')
  const onToggle = (event: Event): void => {
    const opened = event.target
    if (!(opened instanceof view.HTMLDetailsElement) || !opened.open) return
    const name = opened.getAttribute('name')
    if (name === null || name === '') return
    for (const other of all()) {
      if (other !== opened && other.getAttribute('name') === name) other.open = false
    }
  }

  let openedForPrint: HTMLDetailsElement[] = []
  const onBeforePrint = (): void => {
    openedForPrint = all().filter((details) => !details.open)
    for (const details of openedForPrint) details.open = true
  }
  const onAfterPrint = (): void => {
    for (const details of openedForPrint) details.open = false
    openedForPrint = []
  }

  openTarget(view.location.hash)
  openFragments([view.location.hash, options.navigationUrl?.() ?? navigationEntry(view)])

  view.addEventListener('hashchange', onHashChange)
  view.addEventListener('beforeprint', onBeforePrint)
  view.addEventListener('afterprint', onAfterPrint)
  root.addEventListener('click', onClick)
  root.addEventListener('beforematch', onBeforeMatch, true)
  // `toggle` does not bubble, so the root listens as it passes on its way down.
  if (exclusive === 'fallback') root.addEventListener('toggle', onToggle, true)

  return () => {
    view.removeEventListener('hashchange', onHashChange)
    view.removeEventListener('beforeprint', onBeforePrint)
    view.removeEventListener('afterprint', onAfterPrint)
    root.removeEventListener('click', onClick)
    root.removeEventListener('beforematch', onBeforeMatch, true)
    root.removeEventListener('toggle', onToggle, true)
  }
}

/** The URL the page was navigated to, which keeps a fragment directive the address has lost. */
function navigationEntry(view: Window): string | undefined {
  const [entry] = view.performance.getEntriesByType('navigation')
  return entry?.name
}
