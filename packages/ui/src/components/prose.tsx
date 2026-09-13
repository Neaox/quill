import type { ReactNode } from 'react'

import type { ThemeVariants } from '@quill/theme'

import { tv } from '../lib/class-names.ts'
import { useThemeVariants } from '../theme/theme-variants.tsx'
import { ScrollGroup } from './scroll-group.tsx'

export const proseStyles = tv({ base: 'layout-grid prose' })
export const proseTableStyles = tv({ base: 'table-scroll' })

export interface ProseProps {
  /**
   * Document content: rendered Markdown, server-rendered HTML, or composed
   * `Block`s. Direct children are grid items and choose their own width.
   */
  readonly children: ReactNode
  readonly className?: string | undefined
  /** Sets the accessible name of the article region. */
  readonly label?: string | undefined
  /**
   * How sections are separated: the theme's `rules` variant. Set on the
   * article rather than read from an ancestor so a document exported on its
   * own still carries the treatment it was published with, and so the
   * `rules-*` variants resolve inside it.
   */
  readonly rules?: ThemeVariants['rules'] | undefined
}

/**
 * The reading surface.
 *
 * The reading grid and the reading typography are the same element: every
 * block of a document is a direct child, so it can ask for `content`, `wide`,
 * or `full` by name while the measure, the vertical rhythm, and the type scale
 * stay under one set of rules. Headings, lists, tables, code, quotes, and
 * figures are styled by element, so raw HTML from the Markdown pipeline needs
 * no classes of its own.
 *
 * The faces come from the theme: `--font-reading` for the body, `--font-display`
 * for the headings. The sizes do not (ADR-028, layer 0).
 */
export function Prose({ children, className, label, rules }: ProseProps) {
  const variants = useThemeVariants()

  return (
    <article
      aria-label={label}
      data-rules={rules ?? variants.rules}
      className={proseStyles({ className })}
    >
      {children}
    </article>
  )
}

export interface ProseTableProps {
  readonly children: ReactNode
  readonly className?: string | undefined
  /** Names the scroll region so a keyboard user knows what they are scrolling. */
  readonly label: string
}

/**
 * A table in a document.
 *
 * The same scroll behaviour as any other wide block (`ScrollGroup`), with the
 * reading surface's treatment on top: `wide` or `full` simply give the columns
 * room before scrolling is needed.
 */
export function ProseTable({ children, className, label }: ProseTableProps) {
  return (
    <ScrollGroup label={label} className={proseTableStyles({ className })}>
      {children}
    </ScrollGroup>
  )
}
