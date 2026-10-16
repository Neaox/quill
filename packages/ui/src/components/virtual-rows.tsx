import { observeElementRect, useVirtualizer } from '@tanstack/react-virtual'
import { useRef, type ReactNode } from 'react'

import { tv } from '../lib/class-names.ts'

/**
 * A list drawn as a window onto its rows, for a list that can be as long as an organisation is
 * large. The cost of a render is the rows in view, not the rows there are.
 *
 * `VirtualTree` is the navigation tree's own; this is the same technique for any other list of
 * rows whose heights are known without measuring them: each row says its height, so one place
 * can be a heading and the next an entry. The region scrolls on its own, to a height the caller
 * gives it, because a list of thousands that grew the page would only move the problem.
 */

/** The size of the window when it cannot be measured (not laid out yet, or no layout at all). */
const UNMEASURED = { width: 320, height: 560 } as const

/** Rows drawn beyond the edges of the view, so scrolling does not show a gap. */
const OVERSCAN = 8

export const virtualRowsStyles = tv({
  slots: {
    scroller: 'overflow-y-auto overscroll-contain',
    list: 'relative m-0 h-(--total) list-none p-0',
    item: 'absolute inset-x-0 top-0 h-(--size) translate-y-(--start)',
  },
})

export interface VirtualRowsProps<Row> {
  /** Names the list. */
  readonly label: string
  readonly rows: readonly Row[]
  /** A row's identity, which survives the rows around it changing. */
  readonly rowKey: (row: Row) => string
  /** A row's height in pixels. Known, not measured: that is what lets it be placed. */
  readonly rowHeight: (row: Row) => number
  readonly renderRow: (row: Row) => ReactNode
  /** Sizes the scrolling region, which is what the window is cut from: a `max-h-*`. */
  readonly className?: string | undefined
}

/** A value for a custom property, which is how a row's place and size reach the stylesheet. */
function vars(values: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return values
}

export function VirtualRows<Row>({
  label,
  rows,
  rowKey,
  rowHeight,
  renderRow,
  className,
}: VirtualRowsProps<Row>) {
  const styles = virtualRowsStyles()
  const scroller = useRef<HTMLDivElement>(null)
  // The window is this component's alone: what it returns is read in this render and never handed
  // to anything that memoises it, which is the lint's worry.
  // oxlint-disable-next-line react/incompatible-library -- see above
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => {
      const row = rows[index]
      return row === undefined ? 0 : rowHeight(row)
    },
    overscan: OVERSCAN,
    initialRect: UNMEASURED,
    observeElementRect: (instance, report) =>
      observeElementRect(instance, (rect) => {
        report(rect.height === 0 ? UNMEASURED : rect)
      }),
    getItemKey: (index) => {
      const row = rows[index]
      return row === undefined ? index : rowKey(row)
    },
  })

  return (
    <div ref={scroller} className={styles.scroller({ className })}>
      <ul
        aria-label={label}
        className={styles.list()}
        // The height of every row there is, so the scrollbar is the size of the whole list.
        style={vars({ '--total': `${String(virtualizer.getTotalSize())}px` })}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]
          if (row === undefined) return undefined
          return (
            <li
              key={item.key}
              className={styles.item()}
              // A window cannot show the rows it does not draw, so it says they are there.
              aria-posinset={item.index + 1}
              aria-setsize={rows.length}
              style={vars({
                '--start': `${String(item.start)}px`,
                '--size': `${String(item.size)}px`,
              })}
            >
              {renderRow(row)}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
