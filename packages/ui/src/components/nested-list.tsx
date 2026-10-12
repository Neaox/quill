import type { ReactNode } from 'react'

import { tv } from '../lib/class-names.ts'
import { PlainLink } from '../lib/link.tsx'
import type { LinkComponent, LinkTarget } from '../lib/link.tsx'

/**
 * A list of things that contain things: the document's headings, the documents
 * beneath a document.
 *
 * It is the one place a nested outline is laid out, so the contents block, the
 * child-documents block, and the writing surface's previews of both are the
 * same list. What each entry *is* — a link, a button that scrolls, plain text —
 * is the caller's choice (`renderLabel`); by default an entry with a `link` is a
 * link through the design system's link seam, and one without is text.
 */

export const nestedListStyles = tv({
  slots: {
    list: 'flex flex-col gap-1 text-sm',
    item: 'flex flex-col gap-1',
    link: [
      'text-foreground underline decoration-border-strong underline-offset-2',
      'transition-colors ease-standard hover:text-accent hover:decoration-accent',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
  },
  variants: {
    /** Only a list inside an entry is indented; the first level is flush. */
    nested: { true: { list: 'ps-4' } },
  },
})

export interface NestedListItem {
  readonly id: string
  readonly label: string
  /** Where the entry goes, as a route and its parameters (ADR-035). */
  readonly link?: LinkTarget | undefined
  readonly children?: readonly NestedListItem[] | undefined
}

export interface NestedListProps {
  readonly items: readonly NestedListItem[]
  /** How many levels to draw; entries deeper than this are left out. Omitted, all of them. */
  readonly depth?: number | undefined
  readonly linkComponent?: LinkComponent | undefined
  /** Replaces how an entry is drawn. Omitted, an entry with a `link` is a link and any other is text. */
  readonly renderLabel?: ((item: NestedListItem) => ReactNode) | undefined
  readonly className?: string | undefined
  readonly 'aria-label'?: string | undefined
}

export function NestedList({
  items,
  depth = Number.POSITIVE_INFINITY,
  linkComponent: LinkComp = PlainLink,
  renderLabel,
  className,
  'aria-label': label,
}: NestedListProps) {
  const styles = nestedListStyles()

  function entry(item: NestedListItem): ReactNode {
    if (renderLabel !== undefined) return renderLabel(item)
    if (item.link === undefined) return item.label
    return (
      <LinkComp {...item.link} className={styles.link()}>
        {item.label}
      </LinkComp>
    )
  }

  function level(
    entries: readonly NestedListItem[],
    remaining: number,
    nested: boolean,
  ): ReactNode {
    if (entries.length === 0 || remaining < 1) return null
    return (
      <ul
        className={nestedListStyles({ nested }).list({ className: nested ? undefined : className })}
        aria-label={nested ? undefined : label}
      >
        {entries.map((item) => (
          <li key={item.id} className={styles.item()}>
            {entry(item)}
            {level(item.children ?? [], remaining - 1, true)}
          </li>
        ))}
      </ul>
    )
  }

  return level(items, depth, false)
}
