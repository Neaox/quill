import type { ReactNode } from 'react'

import { tv } from '../lib/class-names.ts'

export const scrollGroupStyles = tv({ base: 'focus-ring w-full overflow-x-auto' })

export interface ScrollGroupProps {
  readonly children: ReactNode
  /** Names the region, so a keyboard user knows what they are scrolling. */
  readonly label: string
  readonly className?: string | undefined
}

/**
 * A horizontally scrollable, focusable, labelled region.
 *
 * ADR-027 makes a table scroll inside whatever width its block was given
 * rather than pushing the measure out, and a region that scrolls has to be
 * reachable without a pointer. That is one behaviour, so it is one component:
 * the document table and the data table differ in their treatment, never in
 * how they scroll.
 */
export function ScrollGroup({ children, label, className }: ScrollGroupProps) {
  return (
    <div className={scrollGroupStyles({ className })} tabIndex={0} role="group" aria-label={label}>
      {children}
    </div>
  )
}
