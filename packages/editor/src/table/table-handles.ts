import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { TableMap } from 'prosemirror-tables'

import { pageLayoutFrame, pageNearness } from '../document/measuring.ts'

import {
  insertLine,
  moveColumn,
  moveRow,
  selectLine,
  setTableAttributeAt,
} from './table-commands.ts'

/**
 * The table's handles (ADR-040, phase 2), Confluence's at their best:
 *
 * - a grip above every column and beside every row: a click selects it, and
 *   a drag moves it;
 * - a "+" on every boundary between them, and at both ends: it inserts a
 *   row or column there, and while the pointer is on it a line across the
 *   table shows where;
 * - a handle on every border between columns: a drag resizes the two
 *   columns either side, as proportions, with a live readout of both shares;
 * - a handle on the table's trailing edge: a drag sets its width, snapping
 *   to the content, wide and full tracks with a live readout, and free in
 *   steps of five per cent between them.
 *
 * Nothing reflows while the pointer moves: a drag moves an overlay with a
 * transform, or the column group's widths, inside one animation frame, and
 * the document changes once, on release, in one transaction (one undo).
 * The handles are for a pointer; the table toolbar and its keys
 * (`table-actions.ts`) do everything they do, so they are hidden from
 * assistive technology.
 */

const SNAP = 16
const MIN_COLUMN = 40

/** How far a grip must travel before a press is a drag rather than a click. */
const DRAG_THRESHOLD = 4

/** The reading grid's three widths, in pixels, measured from its tracks. */
export interface Tracks {
  readonly content: number
  readonly wide: number
  readonly full: number
}

/** Where a row or column starts along its axis, and how far it runs. */
export interface Extent {
  readonly start: number
  readonly size: number
}

/** The grid's tracks from its computed `grid-template-columns`. */
export function tracksOf(template: string): Tracks | undefined {
  const sizes = template
    .split(/\s+/u)
    .map((each) => Number.parseFloat(each))
    .filter((each) => Number.isFinite(each))
  if (sizes.length !== 5) return undefined
  const [lead = 0, wideLead = 0, content = 0, wideTrail = 0, trail = 0] = sizes
  return {
    content,
    wide: wideLead + content + wideTrail,
    full: lead + wideLead + content + wideTrail + trail,
  }
}

/** What a dragged width becomes: a named track when near one, else a share of the full track. */
export function widthFor(
  width: number,
  tracks: Tracks,
): { readonly value: string | undefined; readonly label: string } {
  if (Math.abs(width - tracks.content) <= SNAP) return { value: 'content', label: 'Content' }
  if (Math.abs(width - tracks.wide) <= SNAP) return { value: undefined, label: 'Wide' }
  if (width >= tracks.full - SNAP) return { value: 'full', label: 'Full' }
  const percent = Math.min(100, Math.max(5, Math.round(((width / tracks.full) * 100) / 5) * 5))
  return { value: `${percent}%`, label: `${percent}%` }
}

/** Two neighbouring columns' widths after a border between them moves by `delta`. */
export function resized(widths: readonly number[], border: number, delta: number): number[] {
  const left = widths[border] ?? 0
  const right = widths[border + 1] ?? 0
  const moved = Math.max(MIN_COLUMN - left, Math.min(right - MIN_COLUMN, delta))
  return widths.map((width, index) =>
    index === border ? left + moved : index === border + 1 ? right - moved : width,
  )
}

/** Widths as the proportions `columns` holds, in whole per cents of the table. */
export function proportionsOf(widths: readonly number[]): string {
  const total = widths.reduce((sum, each) => sum + each, 0)
  return widths.map((each) => `${Math.max(1, Math.round((each / total) * 100))}fr`).join(' ')
}

/** Where a drag over these lines lands: the last line whose middle it has passed, or the first. */
export function dropIndex(extents: readonly Extent[], at: number): number {
  return extents.reduce(
    (index, extent, line) => (at > extent.start + extent.size / 2 ? line : index),
    0,
  )
}

/** Each line's start, then the last one's end: where a "+" can insert. */
export function boundaries(extents: readonly Extent[]): number[] {
  return [
    ...extents.map((extent) => extent.start),
    extents.reduce((end, extent) => Math.max(end, extent.start + extent.size), 0),
  ]
}

/** Calls `place` for each value and the element drawn for it, as far as both go. */
function alongside<V, E>(
  values: readonly V[],
  elements: readonly E[],
  place: (value: V, drawn: E, index: number) => void,
): void {
  values.forEach((value, index) => {
    const drawn = elements[index]
    if (drawn !== undefined) place(value, drawn, index)
  })
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag)
  created.className = className
  return created
}

type Axis = 'row' | 'column'

/** Where the handles go, as read from the table. */
interface Placement {
  readonly columns: readonly Extent[]
  readonly lines: readonly Extent[]
  readonly width: number
  readonly height: number
  /** Whether a row can go above the first, which a header row forbids. */
  readonly aboveHeader: boolean | undefined
}

export class TableHandles {
  readonly layer: HTMLElement
  private readonly grips: Record<Axis, HTMLElement[]> = { row: [], column: [] }
  private readonly inserts: Record<Axis, HTMLButtonElement[]> = { row: [], column: [] }
  private readonly borders: HTMLElement[] = []
  private readonly edge: HTMLElement
  private readonly readout: HTMLElement
  private readonly ghost: HTMLElement
  private readonly line: HTMLElement
  // Placed in the page's layout frame, and only while near the screen: a
  // long document's tables would each lay the page out again otherwise.
  private readonly frame = pageLayoutFrame()
  private near = false
  private stale = true
  private readonly unwatch: () => void
  private readonly onScroll = (): void => {
    this.schedule()
  }
  // The frame changes size with the window and the panes beside it: the handles follow.
  private readonly resizing = new ResizeObserver(() => {
    this.schedule()
  })

  private readonly view: EditorView
  private readonly getPos: () => number | undefined
  private readonly scroller: HTMLElement
  private readonly table: HTMLTableElement

  constructor(
    view: EditorView,
    getPos: () => number | undefined,
    scroller: HTMLElement,
    table: HTMLTableElement,
  ) {
    this.view = view
    this.getPos = getPos
    this.scroller = scroller
    this.table = table
    this.layer = element('div', 'table-handles')
    this.layer.contentEditable = 'false'
    this.layer.setAttribute('aria-hidden', 'true')
    this.edge = element('div', 'table-width-handle')
    this.readout = element('div', 'table-readout')
    this.readout.hidden = true
    this.ghost = element('div', 'table-drag-ghost')
    this.line = element('div', 'table-drop-line')
    this.layer.append(this.edge, this.readout, this.ghost, this.line)
    this.edge.addEventListener('pointerdown', (event) => {
      this.resizeWidth(event)
    })
    this.scroller.addEventListener('scroll', this.onScroll, { passive: true })
    this.resizing.observe(this.scroller)
    this.unwatch = pageNearness().watch(this.scroller, (near) => {
      this.near = near
      if (near && this.stale) this.schedule()
    })
  }

  /** Brings the handles in line with the table's shape, then places them. */
  render(node: PMNode): void {
    const map = TableMap.get(node)
    this.count(this.grips.row, map.height, (index) => this.grip('row', index))
    this.count(this.grips.column, map.width, (index) => this.grip('column', index))
    this.count(this.inserts.row, map.height + 1, (index) => this.insert('row', index))
    this.count(this.inserts.column, map.width + 1, (index) => this.insert('column', index))
    this.count(this.borders, map.width - 1, (index) => this.border(index))
    this.schedule()
  }

  /** Adds or removes handles until there are `wanted`, making each new one with `make`. */
  private count<E extends HTMLElement>(
    list: E[],
    wanted: number,
    make: (index: number) => E,
  ): void {
    while (list.length > wanted) list.pop()?.remove()
    while (list.length < wanted) {
      const made = make(list.length)
      list.push(made)
      this.layer.append(made)
    }
  }

  private grip(axis: Axis, index: number): HTMLElement {
    const grip = element('div', `table-grip table-grip-${axis}`)
    grip.addEventListener('pointerdown', (event) => {
      this.drag(event, grip, axis, index)
    })
    return grip
  }

  private insert(axis: Axis, boundary: number): HTMLButtonElement {
    const insert = element('button', `table-insert table-insert-${axis}`)
    insert.type = 'button'
    insert.tabIndex = -1
    insert.textContent = '+'
    // A press must not take the caret out of the document before the click lands.
    insert.addEventListener('pointerdown', (event) => {
      event.preventDefault()
    })
    insert.addEventListener('click', () => {
      this.withTable((pos) => insertLine(axis, boundary, pos)(this.view.state, this.view.dispatch))
      this.view.focus()
    })
    return insert
  }

  private border(index: number): HTMLElement {
    const border = element('div', 'table-column-border')
    border.addEventListener('pointerdown', (event) => {
      this.resizeColumns(event, border, index)
    })
    return border
  }

  /**
   * A drag under way, or none: the layer says which, and the document root
   * turns text selection off for exactly as long as the drag lasts.
   */
  private dragging(kind: string | undefined): void {
    const root = this.view.dom.ownerDocument.documentElement
    if (kind === undefined) {
      delete this.layer.dataset['dragging']
      delete root.dataset['dragging']
      return
    }
    this.layer.dataset['dragging'] = kind
    root.dataset['dragging'] = 'true'
  }

  /** Places the handles in the next frame, or once the table comes near the screen. */
  private schedule(): void {
    this.stale = true
    if (!this.near) return
    this.frame.schedule(this, () => this.place())
  }

  /** The columns' extents along the table, read from the first row's cells. */
  private columnExtents(): Extent[] {
    /* v8 ignore next -- a GFM table always has its header row. */
    const cells = this.table.rows.item(0)?.cells ?? []
    return Array.from(cells, (cell) => ({ start: cell.offsetLeft, size: cell.offsetWidth }))
  }

  /** The rows' extents down the table. */
  private rowExtents(): Extent[] {
    return Array.from(this.table.rows, (row) => ({ start: row.offsetTop, size: row.offsetHeight }))
  }

  /**
   * Every read first, then every write, which the layout frame runs after
   * every other control's reads: the grips and the "+"s follow the cells.
   */
  private place(): () => void {
    this.stale = false
    const scrollLeft = this.scroller.scrollLeft
    const columns = this.columnExtents().map(({ start, size }) => ({
      start: start - scrollLeft,
      size,
    }))
    const lines = this.rowExtents()
    const width = Math.min(this.table.offsetWidth, this.scroller.clientWidth)
    const height = this.table.offsetHeight
    const aboveHeader = this.withTable((pos) => insertLine('row', 0, pos)(this.view.state))
    return () => {
      this.write({ columns, lines, width, height, aboveHeader })
    }
  }

  private write({ columns, lines, width, height, aboveHeader }: Placement): void {
    this.layer.style.setProperty('--table-handles-width', `${String(width)}px`)
    this.layer.style.setProperty('--table-handles-height', `${String(height)}px`)
    alongside(columns, this.grips.column, ({ start, size }, grip) => {
      grip.style.transform = `translateX(${String(start)}px)`
      grip.style.width = `${String(size)}px`
    })
    alongside(columns, this.borders, ({ start, size }, border) => {
      border.style.transform = `translateX(${String(start + size)}px)`
    })
    alongside(lines, this.grips.row, ({ start, size }, grip) => {
      grip.style.transform = `translateY(${String(start)}px)`
      grip.style.height = `${String(size)}px`
    })
    alongside(boundaries(columns), this.inserts.column, (at, insert) => {
      insert.style.transform = `translateX(${String(at)}px)`
      // A boundary scrolled out of the table's frame has nothing to insert beside.
      insert.hidden = at < 0 || at > width
    })
    alongside(boundaries(lines), this.inserts.row, (at, insert, index) => {
      insert.style.transform = `translateY(${String(at)}px)`
      // Nothing goes above a header row.
      insert.hidden = index === 0 && aboveHeader !== true
    })
    this.edge.style.transform = `translateX(${String(width)}px)`
  }

  /**
   * Runs `act` with the table's position. A view's position is unknown only
   * once its node has left the document, and its handles with it.
   */
  private withTable<T>(act: (pos: number) => T): T | undefined {
    const pos = this.getPos()
    /* v8 ignore next */
    return pos === undefined ? undefined : act(pos)
  }

  /**
   * Follows one drag on `handle`: `move` with each pointer move, then `end`,
   * once, when the pointer is released or the drag is cancelled.
   */
  private follow(
    event: PointerEvent,
    handle: HTMLElement,
    move: (next: PointerEvent) => void,
    end: () => void,
  ): void {
    event.preventDefault()
    handle.setPointerCapture(event.pointerId)
    const finish = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)
      this.dragging(undefined)
      this.readout.hidden = true
      end()
      this.view.focus()
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
  }

  /**
   * A grip pressed: a click selects its row or column; a drag moves it. The
   * extents are read once, at the press; the ghost moves by transform.
   */
  private drag(event: PointerEvent, grip: HTMLElement, axis: Axis, index: number): void {
    const extents = axis === 'row' ? this.rowExtents() : this.columnExtents()
    const own = extents[index]
    /* v8 ignore next -- a grip is drawn for every row and column there is. */
    if (own === undefined) return
    const origin = axis === 'row' ? event.clientY : event.clientX
    const translate = axis === 'row' ? 'translateY' : 'translateX'
    let target = index
    let moved = false
    this.ghost.dataset['axis'] = axis
    this.line.dataset['axis'] = axis
    const move = (next: PointerEvent): void => {
      const delta = (axis === 'row' ? next.clientY : next.clientX) - origin
      if (!moved && Math.abs(delta) < DRAG_THRESHOLD) return
      moved = true
      this.dragging(axis)
      target = dropIndex(extents, own.start + own.size / 2 + delta)
      /* v8 ignore next -- the drop index is one of the extents'. */
      const landing = extents[target] ?? own
      const line = target > index ? landing.start + landing.size : landing.start
      this.ghost.style.transform = `${translate}(${String(own.start + delta)}px)`
      this.ghost.style.setProperty(axis === 'row' ? 'height' : 'width', `${String(own.size)}px`)
      this.line.style.transform = `${translate}(${String(line)}px)`
    }
    this.follow(event, grip, move, () => {
      this.withTable((pos) => {
        const { state, dispatch } = this.view
        if (!moved) selectLine(axis, index, pos)(state, dispatch)
        else (axis === 'row' ? moveRow : moveColumn)(index, target, pos)(state, dispatch)
      })
    })
  }

  /** A border dragged: its two columns resize as proportions, previewed in the column group. */
  private resizeColumns(event: PointerEvent, handle: HTMLElement, border: number): void {
    const group = this.table.querySelector(':scope > colgroup')
    /* v8 ignore next -- the table view draws every table with its column group. */
    if (group === null) return
    const widths = this.columnExtents().map((extent) => extent.size)
    const total = widths.reduce((sum, each) => sum + each, 0)
    let current = widths
    this.dragging('border')
    /* v8 ignore next -- the shares asked for are the two columns either side of a border. */
    const share = (index: number): number => ((current[index] ?? 0) / total) * 100
    const move = (next: PointerEvent): void => {
      current = resized(widths, border, next.clientX - event.clientX)
      // The table view's column group previews the new shares while the drag lasts.
      if (group.children.length !== current.length) {
        group.replaceChildren(...current.map(() => document.createElement('col')))
        this.table.classList.add('table-proportional')
      }
      for (const [index, col] of group.querySelectorAll('col').entries()) {
        col.style.width = `${String(share(index))}%`
      }
      this.readout.textContent = `${String(Math.round(share(border)))}% · ${String(Math.round(share(border + 1)))}%`
      this.readout.style.transform = handle.style.transform
      this.readout.hidden = false
    }
    this.follow(event, handle, move, () => {
      if (current === widths) return
      this.withTable((pos) =>
        setTableAttributeAt(
          pos,
          'columns',
          proportionsOf(current),
        )(this.view.state, this.view.dispatch),
      )
    })
  }

  /** The trailing edge dragged: the table's width, snapped to the grid's tracks. */
  private resizeWidth(event: PointerEvent): void {
    const block = this.layer.closest('.table-block')
    const tracks = tracksOf(getComputedStyle(this.view.dom).gridTemplateColumns)
    if (!(block instanceof HTMLElement) || tracks === undefined) return
    const start = block.offsetWidth
    let chosen = widthFor(start, tracks)
    this.dragging('width')
    const move = (next: PointerEvent): void => {
      const width = start + next.clientX - event.clientX
      chosen = widthFor(width, tracks)
      this.readout.textContent = chosen.label
      this.readout.hidden = false
      this.edge.style.transform = `translateX(${String(width)}px)`
      this.readout.style.transform = this.edge.style.transform
    }
    this.follow(event, this.edge, move, () => {
      this.withTable((pos) =>
        setTableAttributeAt(pos, 'width', chosen.value)(this.view.state, this.view.dispatch),
      )
      this.schedule()
    })
  }

  destroy(): void {
    this.frame.cancel(this)
    this.unwatch()
    this.scroller.removeEventListener('scroll', this.onScroll)
    this.resizing.disconnect()
  }
}
