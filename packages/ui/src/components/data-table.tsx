import type { ReactNode } from 'react'

import { tv } from '../lib/class-names.ts'
import { ScrollGroup } from './scroll-group.tsx'

export const dataTableStyles = tv({ base: 'data-table' })

export interface DataTableProps {
  /** `thead` and `tbody`, with `th` carrying `scope`. */
  readonly children: ReactNode
  /** Names the scroll region. */
  readonly label: string
  /** The table's own caption, shown under it. */
  readonly caption?: string | undefined
  readonly className?: string | undefined
}

/**
 * Tabular data outside a document: a revision list, an audit trail, a settings
 * table.
 *
 * The table element is here rather than at the call site so the treatment
 * cannot be forgotten or half-copied: monospace column headings over the
 * artboard's two-pixel rule, compact rows, and no card around it. A document's
 * table is `ProseTable` instead, which is the same scroll behaviour with the
 * reading surface's treatment.
 */
export function DataTable({ children, label, caption, className }: DataTableProps) {
  return (
    <ScrollGroup label={label} className={className}>
      <table className={dataTableStyles()}>
        {caption === undefined ? undefined : <caption>{caption}</caption>}
        {children}
      </table>
    </ScrollGroup>
  )
}
