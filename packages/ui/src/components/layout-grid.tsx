import type { ReactNode } from 'react'

import { tv } from '../lib/class-names.ts'

/** The three layout widths of ADR-027. */
export type BlockWidth = 'content' | 'wide' | 'full'

export const layoutGridStyles = tv({ base: 'layout-grid' })

export const blockStyles = tv({
  variants: {
    width: { content: 'layout-content', wide: 'layout-wide', full: 'layout-full' },
  },
  defaultVariants: { width: 'content' },
})

export interface LayoutGridProps {
  readonly children: ReactNode
  readonly className?: string | undefined
}

/**
 * The named-line reading grid (ADR-027).
 *
 * Direct children are grid items; each spans the `content`, `wide`, or `full`
 * lines. The widths are properties of the grid, not of the blocks, so a
 * document lays out identically in the reader, the editor, a server-rendered
 * public page, and an HTML export.
 */
export function LayoutGrid({ children, className }: LayoutGridProps) {
  return <div className={layoutGridStyles({ className })}>{children}</div>
}

export interface BlockProps {
  readonly width?: BlockWidth
  readonly children: ReactNode
  readonly className?: string | undefined
}

/**
 * One block of a document, at a chosen width.
 *
 * `content` is the reading measure and the default; `wide` and `full` are the
 * breakout widths a table, diagram, or image asks for. Below the medium
 * breakpoint all three collapse to the single column, so nothing is clipped.
 */
export function Block({ width, children, className }: BlockProps) {
  return <div className={blockStyles({ width, className })}>{children}</div>
}
