import { defaultRangeExtractor, observeElementRect, useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef } from 'react'

import { tv } from '../lib/class-names.ts'
import { PlainLink, type LinkComponent, type LinkTarget } from '../lib/link.tsx'
import { ChevronDownIcon, ChevronRightIcon } from './icons.tsx'
import { Menu } from './menu.tsx'
import { Spinner } from './spinner.tsx'
import { treeStyles, type TreeNodeAction } from './tree.tsx'

/**
 * The navigation tree as a window onto its rows (ADR-049).
 *
 * `Tree` draws every node it is given. That is right for the few a picker holds and wrong for
 * a workspace, whose tree has as many nodes as it has documents: so this one is given the
 * *rows* — what is open, already flattened, in the order a reader sees them — and draws only
 * the rows in view, however many there are. The cost of a render is the rows on screen, not
 * the size or the depth of the workspace.
 *
 * What is open, and what has been loaded, are the caller's: this knows how to draw a row, how
 * to say what it is among its siblings (`aria-level`, `aria-posinset` and `aria-setsize`,
 * because a window cannot show the rows it does not draw, so it must say they are there), and
 * where to put them. A row is one line of a fixed height, which is what lets it be placed
 * without being measured.
 */

/** One line of the list, in pixels: `min-h-7`, which every row in `treeStyles` is. */
const ROW_HEIGHT = 28

/**
 * The size of the window when it cannot be measured: a region that is not laid out (not shown
 * yet, or a document with no layout at all) reports none, and a window of no height draws no
 * rows, which is never the answer. A screenful is.
 */
const UNMEASURED = { width: 280, height: 560 } as const

/** Rows drawn beyond the edges of the view, so scrolling does not show a gap. */
const OVERSCAN = 8

export const virtualTreeStyles = tv({
  slots: {
    root: 'flex flex-col py-3',
    scroller: 'overflow-y-auto overscroll-contain',
    list: 'relative m-0 h-(--total) list-none p-0',
    item: 'absolute inset-x-0 top-0 flex h-7 translate-y-(--start) items-center',
    indent: 'flex min-w-0 grow items-center gap-0.5 ps-(--indent)',
    toggle: [
      'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted',
      'hover:bg-surface hover:text-foreground',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
    ],
    spacer: 'size-6 shrink-0',
    quiet: 'flex min-h-7 grow items-center gap-1.5 px-2 text-2xs text-muted',
    more: [
      'flex min-h-7 grow cursor-pointer items-center gap-1.5 rounded-md px-2 text-2xs text-muted',
      'hover:bg-surface hover:text-foreground disabled:cursor-progress',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
    ],
  },
  variants: {
    /**
     * The collection whose documents are at the top of the window stays at the top of it, on the
     * page's own ground so what scrolls beneath it does not show through: a reader deep in a long
     * list still knows which collection it is in. It is the one row that is in the flow of its
     * list rather than placed in it, which is what lets it stay.
     */
    pinned: { true: { item: 'sticky z-10 translate-y-0 bg-background' } },
  },
})

/**
 * The section pinned over a window whose first row in view is `firstInView`: the last one at or
 * before the row *below* it. The pinned heading covers the row at the top of the view, so a
 * heading that is the next row is about to be covered by it, and takes over instead; otherwise
 * the next collection's name would scroll up beneath the last one's. Pure, so the window (which
 * must draw it though it is above the view) and the row (which must pin it) cannot disagree.
 */
function sectionAt(sections: readonly number[], firstInView: number): number | undefined {
  // A heading already at the top of the view is the one pinned: it is where it would be pinned
  // anyway, and letting the heading below take over would cover it. That is what hid an empty
  // collection, a heading with another heading straight under it, along with its controls.
  if (sections.includes(firstInView)) return firstInView
  return sections.findLast((index) => index <= firstInView + 1)
}

export type VirtualTreeRow =
  | {
      readonly kind: 'section'
      readonly id: string
      /** The collection's name. */
      readonly label: string
      readonly action?: TreeNodeAction | undefined
      readonly actions?: readonly TreeNodeAction[] | undefined
    }
  | {
      readonly kind: 'node'
      readonly id: string
      readonly label: string
      readonly link: LinkTarget
      /** 0 at the top of a collection. */
      readonly depth: number
      /** Where it is among the documents under its parent, from 1; what a window cannot show. */
      readonly position: number
      /** How many documents are under its parent, when that is known. */
      readonly siblings: number
      /** It has documents under it, so it can be opened. */
      readonly expandable: boolean
      readonly expanded: boolean
      readonly actions: readonly TreeNodeAction[]
    }
  | {
      readonly kind: 'more'
      readonly id: string
      readonly depth: number
      readonly label: string
      /** Loading the next page: pressing it again would ask twice. */
      readonly busy: boolean
    }
  | {
      readonly kind: 'status'
      readonly id: string
      readonly depth: number
      readonly label: string
      readonly busy: boolean
    }

export interface VirtualTreeProps {
  /** Names the navigation landmark. */
  readonly label: string
  readonly rows: readonly VirtualTreeRow[]
  /** The document being read: marked `aria-current="page"`, nothing else. */
  readonly currentId?: string | undefined
  /** A node's toggle was pressed. */
  readonly onToggle: (id: string) => void
  /** "Show more" under a parent was pressed; the id is the row's. */
  readonly onMore: (id: string) => void
  /** How a row's link renders: the application's router `Link`, normally. */
  readonly linkComponent?: LinkComponent | undefined
  /** Sizes the scrolling region, which is what the window is cut from. */
  readonly className?: string | undefined
}

/** How far a level is indented: one step per level, the width of a toggle. */
const INDENT_REM = 0.75

/**
 * A value for a custom property, which is what a row's place and indent are: the stylesheet
 * says how a row is drawn, and these only say how far. (A property typed as a record rather
 * than a literal, because `CSSProperties` does not list the ones a stylesheet invents.)
 */
function vars(values: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return values
}

const indentOf = (depth: number) => vars({ '--indent': `${String(depth * INDENT_REM)}rem` })

function NodeRow({
  row,
  currentId,
  onToggle,
  Link,
}: {
  readonly row: Extract<VirtualTreeRow, { kind: 'node' }>
  readonly currentId: string | undefined
  readonly onToggle: (id: string) => void
  readonly Link: LinkComponent
}) {
  const styles = { ...treeStyles(), ...virtualTreeStyles() }
  return (
    <div className={styles.indent()} style={indentOf(row.depth)}>
      {row.expandable ? (
        <button
          type="button"
          className={styles.toggle()}
          aria-expanded={row.expanded}
          aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${row.label}`}
          onClick={() => {
            onToggle(row.id)
          }}
        >
          {row.expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </button>
      ) : (
        <span className={styles.spacer()} />
      )}
      <div className={styles.row({ className: 'min-w-0 grow' })}>
        <Link
          {...row.link}
          className={styles.link()}
          aria-current={row.id === currentId ? 'page' : undefined}
        >
          <span className={styles.text()}>{row.label}</span>
        </Link>
        <Menu label={row.label} items={row.actions} triggerClassName={styles.rowMenu()} />
      </div>
    </div>
  )
}

function SectionRow({ row }: { readonly row: Extract<VirtualTreeRow, { kind: 'section' }> }) {
  const styles = treeStyles()
  return (
    <div className={styles.sectionHeader({ className: 'w-full' })}>
      <p className={styles.groupLabel()}>
        <span>{row.label}</span>
      </p>
      <div className={styles.sectionControls()}>
        {row.action === undefined ? undefined : (
          <button
            type="button"
            className={styles.sectionAction()}
            onClick={row.action.onSelect}
            aria-label={row.action.label}
          >
            <span aria-hidden="true">+</span>
          </button>
        )}
        {row.actions === undefined ? undefined : (
          <Menu label={row.label} items={row.actions} triggerClassName={styles.sectionMenu()} />
        )}
      </div>
    </div>
  )
}

export function VirtualTree({
  label,
  rows,
  currentId,
  onToggle,
  onMore,
  linkComponent = PlainLink,
  className,
}: VirtualTreeProps) {
  const styles = virtualTreeStyles()
  const scroller = useRef<HTMLDivElement>(null)
  const sections = rows.flatMap((row, index) => (row.kind === 'section' ? [index] : []))
  // The window is this component's alone: what it returns is read in this render and never handed
  // to anything that memoises it, which is the lint's worry.
  // oxlint-disable-next-line react/incompatible-library -- see above
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    initialRect: UNMEASURED,
    observeElementRect: (instance, report) =>
      observeElementRect(instance, (rect) => {
        report(rect.height === 0 ? UNMEASURED : rect)
      }),
    getItemKey: (index) => rows[index]?.id ?? index,
    // The section above the view is drawn too, so that it can be pinned to the top of it.
    rangeExtractor: (range) => {
      const pinned = sectionAt(sections, range.startIndex)
      const drawn = defaultRangeExtractor(range)
      return pinned === undefined || drawn.includes(pinned) ? drawn : [pinned, ...drawn]
    },
  })
  const pinned = sectionAt(sections, virtualizer.range?.startIndex ?? 0)

  // The document being read is brought into view, and kept there while the rows above it
  // arrive and push it down (each collection loads on its own): a window that only showed the
  // top would leave the one a reader is in somewhere they cannot see. Once the reader scrolls
  // it is theirs, and it is left alone until they go to another document.
  const placed = useRef<{ readonly id: string | undefined; moved: boolean }>({
    id: undefined,
    moved: false,
  })
  const currentIndex = rows.findIndex((row) => row.kind === 'node' && row.id === currentId)
  // Synchronises the region's scroll position, which is the DOM's, with the document being read.
  useEffect(() => {
    if (placed.current.id !== currentId) placed.current = { id: currentId, moved: false }
    if (currentId === undefined || currentIndex < 0 || placed.current.moved) return
    // Every row is one height, so where one is needs no measuring. The region's own scroll
    // position is set, and the window follows from the scroll that sets off.
    const region = scroller.current
    if (region === null) return
    const view = region.clientHeight || UNMEASURED.height
    region.scrollTop = Math.max(0, currentIndex * ROW_HEIGHT - view / 2 + ROW_HEIGHT / 2)
  }, [currentId, currentIndex])

  return (
    <nav aria-label={label} className={styles.root()}>
      <div
        ref={scroller}
        className={styles.scroller({ className })}
        // Only the reader's own hands move it, which is what makes it theirs to leave alone.
        onWheel={() => {
          placed.current.moved = true
        }}
        onPointerDown={() => {
          placed.current.moved = true
        }}
      >
        <ul
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
                className={styles.item({ pinned: item.index === pinned })}
                style={vars({ '--start': `${String(item.start)}px` })}
                {...(row.kind === 'node'
                  ? {
                      'aria-level': row.depth + 1,
                      'aria-posinset': row.position,
                      'aria-setsize': row.siblings,
                    }
                  : {})}
              >
                {row.kind === 'section' ? (
                  <SectionRow row={row} />
                ) : row.kind === 'node' ? (
                  <NodeRow
                    row={row}
                    currentId={currentId}
                    onToggle={onToggle}
                    Link={linkComponent}
                  />
                ) : (
                  <div className={styles.indent()} style={indentOf(row.depth)}>
                    {row.kind === 'more' ? (
                      <button
                        type="button"
                        className={styles.more()}
                        disabled={row.busy}
                        onClick={() => {
                          onMore(row.id)
                        }}
                      >
                        {row.busy ? <Spinner className="size-3" /> : undefined}
                        {row.label}
                      </button>
                    ) : (
                      <p className={styles.quiet()} aria-busy={row.busy}>
                        {row.busy ? <Spinner className="size-3" /> : undefined}
                        {row.label}
                      </p>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
