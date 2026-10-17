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
   * the browser (`exclusiveMode`) unless given; `fallback` makes
   * this module do it.
   */
  readonly exclusive?: 'native' | 'fallback'
  /**
   * The address the page was navigated to, fragment directive and all, which
   * a browser that reads text fragments takes off the address. The navigation
   * entry's, unless given.
   */
  readonly navigationUrl?: string
}

const ID_PREFIX = 'user-content-'

/** A percent-encoded value decoded, or nothing for one that is not well formed. */
function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return ''
  }
}

/**
 * The text each `text=` of a URL's fragment directive starts with: its
 * `textStart`, without the `prefix-,` and `,-suffix` that only narrow where it
 * is, and without its `,textEnd` (the URL Fragment Text Directives draft).
 */
export function textFragments(url: string): string[] {
  const at = url.indexOf(':~:')
  if (at === -1) return []
  return url
    .slice(at + 3)
    .split('&')
    .filter((directive) => directive.startsWith('text='))
    .map((directive) =>
      decode(
        directive
          .slice('text='.length)
          .replace(/^[^,]*-,/u, '')
          .split(',', 1)
          .join(''),
      ),
    )
    .filter((text) => text !== '')
}

/**
 * Who keeps an accordion exclusive: the browser, where it groups details by
 * `name` and closes the others as one opens, or this module.
 */
export function exclusiveMode(view: {
  readonly HTMLDetailsElement: { readonly prototype: object }
}): 'native' | 'fallback' {
  return 'name' in view.HTMLDetailsElement.prototype ? 'native' : 'fallback'
}

/** Text as a reader's find compares it: case and runs of white space aside. */
function comparable(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim().toLocaleLowerCase()
}

/** Whether `node` is part of the summary of `details`, which shows while it is closed. */
function inSummary(details: HTMLDetailsElement, node: Node): boolean {
  return details.querySelector(':scope > summary')?.contains(node) === true
}

/** The details around `node`, nearest first. */
function* detailsAround(node: Node): Generator<HTMLDetailsElement> {
  for (
    let at = node.parentElement?.closest('details');
    at;
    at = at.parentElement?.closest('details')
  ) {
    yield at
  }
}

/** Opens every closed details around `node`. Whether it opened any. */
function reveal(node: Node): boolean {
  let opened = false
  for (const details of detailsAround(node)) {
    if (details.open || inSummary(details, node)) continue
    details.open = true
    opened = true
  }
  return opened
}

/** The element a fragment names, inside `root`, by its id or the id the renderer prefixed. */
function targetOf(root: Node, document: Document, hash: string): Element | undefined {
  const id = decode(hash.replace(/^#/u, '').split(':~:', 1).join(''))
  const found = [id, `${ID_PREFIX}${id}`]
    .filter((candidate) => candidate !== '' && candidate !== ID_PREFIX)
    .map((candidate) => document.getElementById(candidate))
    .find((element) => element !== null && root.contains(element))
  return found ?? undefined
}

/** The URL the page was navigated to, from its navigation entry. */
function navigationEntry(view: Window): string {
  return view.performance
    .getEntriesByType('navigation')
    .map((entry) => entry.name)
    .join(' ')
}

/** Enhances every details in `root`. Returns what takes the enhancement away again. */
export function enhanceDetails(root: Element | Document, options: DetailsOptions = {}): () => void {
  const document = root instanceof Document ? root : root.ownerDocument
  const view = document.defaultView
  if (view === null) return () => undefined

  const all = (): HTMLDetailsElement[] => [...root.querySelectorAll('details')]

  const openTarget = (hash: string): void => {
    const target = targetOf(root, document, hash)
    // Hidden, it could not be scrolled to; open, it can.
    if (target !== undefined && reveal(target)) target.scrollIntoView({ block: 'start' })
  }

  const openFragments = (urls: readonly string[]): void => {
    const wanted = urls.flatMap(textFragments).map(comparable)
    for (const details of all()) {
      const text = comparable(String(details.textContent))
      if (details.open || !wanted.some((fragment) => text.includes(fragment))) continue
      details.open = true
      reveal(details)
    }
  }

  const onHashChange = (): void => {
    openTarget(view.location.hash)
  }

  const onClick = (event: Event): void => {
    const { target } = event
    const link = target instanceof view.Element ? target.closest('a[href^="#"]') : null
    if (link !== null) openTarget(String(link.getAttribute('href')))
  }

  // Find reveals a match; every details on its way to it opens.
  const onBeforeMatch = (event: Event): void => {
    for (const step of event.composedPath()) {
      if (step instanceof view.HTMLDetailsElement) step.open = true
    }
  }

  const onToggle = (event: Event): void => {
    const { target } = event
    if (!(target instanceof view.HTMLDetailsElement) || !target.open) return
    const name = String(target.getAttribute('name'))
    for (const other of all()) {
      if (other !== target && other.getAttribute('name') === name) other.open = false
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
  openFragments([view.location.hash, options.navigationUrl ?? navigationEntry(view)])

  const exclusive = options.exclusive ?? exclusiveMode(view)
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
