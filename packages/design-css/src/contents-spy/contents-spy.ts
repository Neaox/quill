import { STICKY_CHROME_TOP } from '../sticky-chrome/sticky-chrome.ts'

/**
 * "On this page" follows the reader: the contents link for the section being
 * read carries `aria-current="location"`, and the stylesheet marks it
 * (`public-site.css`). The signed-in reader does the same in React
 * (`apps/web`, `table-of-contents.tsx`); this is the server-rendered page's
 * copy of that behaviour, and the one a table-of-contents block reuses.
 *
 * An `IntersectionObserver` decides, not scroll arithmetic, so the browser
 * does the work off the main thread and a long document costs nothing to
 * follow. A section counts as "being read" while its heading is in a band at
 * the top of the view: from just below the sticky header (its height is the
 * `--sticky-chrome-top` the header tracker sets) down to the upper third.
 * Between two headings the last one passed stays current, which is the
 * section the reader is in. A second observer on the page's end marks the
 * last section once the reader reaches the bottom, because a short final
 * section never scrolls up into the band.
 */

/** The IntersectionObserver this needs, injected so it can be tested without a browser. */
export type IntersectionObserverClass = new (
  callback: (records: readonly { target: Element; isIntersecting: boolean }[]) => void,
  options?: IntersectionObserverInit,
) => { observe(target: Element): void; disconnect(): void }

/**
 * The contents lists followed by default: the public site's "On this page"
 * rail, and every table of contents block in a body (ADR-058). One heading
 * may be linked from both, and every link to it is marked.
 */
export const CONTENTS_LINKS = '.site-toc a[href^="#"], nav.toc a[href^="#"]'

export interface ContentsOptions {
  /**
   * The links to follow, as a selector. The signed-in reader draws its own
   * rail in React, so it asks for the blocks in a body alone.
   */
  readonly links?: string
  /** Absent where the browser has none, in which case nothing is followed. */
  readonly Observer?: IntersectionObserverClass | undefined
  /** Pixels hidden under sticky chrome at the top of the view. */
  readonly topInset?: () => number
}

/** The part of the view, below the inset, where a heading counts as being read. */
const BAND_BOTTOM = '-70%'

const CURRENT = 'location'

/** Follows the reader in every contents list under `root` (`CONTENTS_LINKS`). Returns what undoes it. */
export function enhanceContents(root: Document, options: ContentsOptions = {}): () => void {
  const view = root.defaultView
  const Observer = 'Observer' in options ? options.Observer : view?.IntersectionObserver
  const topInset = options.topInset ?? (() => stickyInset(root))
  const sections = sectionsIn(root, options.links ?? CONTENTS_LINKS)
  if (Observer === undefined || sections.length === 0) return () => undefined

  const reading = new Set<Element>()
  let marked: Section | undefined

  const mark = (section: Section | undefined): void => {
    if (section === undefined || section === marked) return
    for (const link of marked?.links ?? []) link.removeAttribute('aria-current')
    for (const link of section.links) link.setAttribute('aria-current', CURRENT)
    marked = section
  }

  const band = new Observer(
    (records) => {
      for (const record of records) {
        if (record.isIntersecting) reading.add(record.target)
        else reading.delete(record.target)
      }
      // Nothing in the band means the reader is between headings; the last
      // one marked is still the section they are in.
      mark(sections.find((section) => reading.has(section.heading)))
    },
    { rootMargin: `-${String(topInset())}px 0px ${BAND_BOTTOM} 0px`, threshold: 0 },
  )
  for (const section of sections) band.observe(section.heading)

  const bottom = new Observer((records) => {
    if (records.some((record) => record.isIntersecting)) mark(sections.at(-1))
  })
  const end = root.querySelector('.site-footer')
  if (end !== null) bottom.observe(end)

  return () => {
    band.disconnect()
    bottom.disconnect()
    for (const link of marked?.links ?? []) link.removeAttribute('aria-current')
  }
}

interface Section {
  readonly heading: Element
  /** Every link to the heading: one in the rail, one in each table of contents. */
  readonly links: readonly Element[]
}

/**
 * Each heading the contents lists link to, with every link to it, in the
 * order the headings come in the document: two lists that link to different
 * headings must still agree on which one comes first.
 */
function sectionsIn(root: Document, selector: string): readonly Section[] {
  const byHeading = new Map<Element, Element[]>()
  for (const link of root.querySelectorAll<HTMLAnchorElement>(selector)) {
    const heading = root.getElementById(decodeURIComponent(link.hash.slice(1)))
    if (heading === null) continue
    const links = byHeading.get(heading) ?? []
    links.push(link)
    byHeading.set(heading, links)
  }
  return [...byHeading]
    .map(([heading, links]) => ({ heading, links }))
    .toSorted((left, right) =>
      left.heading.compareDocumentPosition(right.heading) & Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1,
    )
}

function stickyInset(root: Document): number {
  const pixels = Number.parseFloat(root.documentElement.style.getPropertyValue(STICKY_CHROME_TOP))
  return Number.isFinite(pixels) ? pixels : 0
}
