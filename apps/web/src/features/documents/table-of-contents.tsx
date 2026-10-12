import { useEffect, useMemo, useState } from 'react'

import { ANCHOR_OFFSET_PX, tv } from '@quill/ui'

import type { OutlineEntry } from '../../lib/api/index.ts'
import { activeHeading, positionOf } from '../../lib/documents/active-heading.ts'
import type { BandPosition } from '../../lib/documents/active-heading.ts'

/*
 * The quietest list on the page: the headings in the faintest ink down a
 * hairline, wrapping rather than truncating so a long heading is still read
 * whole. The heading being read takes full ink and lays the accent over its
 * stretch of the hairline — each entry's own leading edge sits on the list's
 * rule — so the position is a mark as well as a colour.
 */
export const tableOfContentsStyles = tv({
  slots: {
    root: '',
    heading: 'section-label pb-2.5',
    list: 'flex flex-col border-s border-border text-xs leading-snug',
    link: [
      '-ms-px block border-s border-transparent py-1 ps-3 text-pretty text-muted',
      'transition-[color,border-color] ease-standard hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
      'current:border-accent current:font-medium current:text-foreground',
    ],
  },
  variants: {
    depth: {
      1: { link: '' },
      2: { link: '' },
      3: { link: 'ps-6' },
      4: { link: 'ps-9' },
    },
  },
})

export interface TableOfContentsProps {
  readonly outline: readonly OutlineEntry[]
  readonly label?: string
  readonly className?: string | undefined
}

interface FlatEntry {
  readonly id: string
  readonly text: string
  readonly depth: 1 | 2 | 3 | 4
}

/** The outline as one list, in document order, clamped to four levels of indent. */
function flatten(entries: readonly OutlineEntry[]): readonly FlatEntry[] {
  return entries.flatMap((entry) => [
    { id: entry.id, text: entry.text, depth: Math.min(entry.depth, 4) as 1 | 2 | 3 | 4 },
    ...flatten(entry.children),
  ])
}

/**
 * A document whose body opens with its own title has that `h1` as the single
 * root of its outline. Listing it would be a contents entry for the page a
 * reader is already on, and would indent every real section under it, so the
 * root is dropped and its children become the list.
 */
export function sections(outline: readonly OutlineEntry[]): readonly OutlineEntry[] {
  const only = outline.length === 1 ? outline[0] : undefined
  return only !== undefined && only.depth === 1 ? only.children : outline
}

/**
 * "On this page": the document's own headings, and which one is being read.
 *
 * The current heading is decided by an `IntersectionObserver` rather than by
 * scroll arithmetic, so the browser does the work off the main thread and a
 * long document costs nothing to follow. `aria-current` carries the fact, and
 * the styling follows the attribute (`docs/architecture/styling.md`), so the
 * position is announced as well as painted.
 *
 * Mount it keyed by the revision whose body is on screen. The headings it
 * observes are that body's DOM nodes, so a new revision is a new subscription
 * and a new "which heading am I in", and a remount says both at once.
 */
export function TableOfContents({
  outline,
  label = 'On this page',
  className,
}: TableOfContentsProps) {
  // Memoised on the outline the query answered with, which is one stable
  // object for as long as that revision is cached: the effect below can then
  // depend on the heading ids themselves, in document order, rather than on a
  // string it would have to take apart again to use them.
  const entries = useMemo(() => flatten(sections(outline)), [outline])
  const headingIds = useMemo(() => entries.map((entry) => entry.id), [entries])
  const [currentId, setCurrentId] = useState<string | undefined>(undefined)

  /* Synchronises with the browser's IntersectionObserver over the headings of
     the body that `DocumentBody` has just mounted — an external system, and
     the only way to know what is on screen without measuring on every scroll.
     A body replaced by a different revision replaces every node this holds,
     which is why the reading page mounts this component keyed by the revision
     on screen: the subscription is rebuilt by a remount rather than by a
     dependency that has to encode two facts as one string. */
  useEffect(() => {
    if (headingIds.length === 0) return undefined

    // Where each heading is relative to the band, kept for as long as this
    // observer lives. The observer reports only what *changed*, so the rest has
    // to be remembered: "which heading is current" depends on all of them.
    const positions = new Map<string, BandPosition>()
    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) positions.set(record.target.id, positionOf(record))
        setCurrentId(activeHeading(headingIds, positions))
      },
      // The band is the top of the viewport: a heading counts as "being read"
      // from the moment it reaches the place it would be scrolled to — the
      // shell's bar plus a step of air, the same `--anchor-offset` the scroll
      // margin uses (`@quill/ui`'s `metrics.ts`) — until the next one does.
      { rootMargin: `-${String(ANCHOR_OFFSET_PX)}px 0px -70% 0px`, threshold: 0 },
    )

    for (const id of headingIds) {
      const heading = document.getElementById(id)
      if (heading !== null) observer.observe(heading)
    }
    return () => {
      observer.disconnect()
    }
  }, [headingIds])

  if (entries.length === 0) return undefined

  const styles = tableOfContentsStyles()

  return (
    <nav aria-label={label} className={styles.root({ className })}>
      <p className={styles.heading()}>{label}</p>
      <ol className={styles.list()}>
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              aria-current={entry.id === currentId ? 'true' : undefined}
              className={tableOfContentsStyles({ depth: entry.depth }).link()}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
