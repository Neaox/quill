import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { TableMap } from 'prosemirror-tables'

import {
  headersOf,
  insertLine,
  moveColumn,
  moveRow,
  selectLine,
  selectTable,
  setTableAttributeAt,
} from './table-commands.ts'
import { selectedLines, tableAt, tableContext, wholeTableSelected } from './table-context.ts'
import type { LineSelection } from './table-context.ts'

/**
 * The table's handles (ADR-040, phase 2), Confluence's at their best:
 *
 * - a grip above every column and beside every row: a click selects it (and
 *   the toolbar becomes that line's), a drag moves it;
 * - a "+" on every border between lines, and on the outer edges: pressing it
 *   inserts a line there, the caret in its first cell. It is a dot until the
 *   pointer comes near, then a button with a guide across the table showing
 *   where the line will go;
 * - a handle on every border between columns: a drag resizes the two
 *   columns either side, as proportions, with a live readout of both shares;
 * - a handle on the table's trailing edge: a drag sets its width, snapping
 *   to the content, wide and full tracks with a live readout, and free in
 *   steps of five per cent between them.
 *
 * Nothing reflows while the pointer moves: a drag moves an overlay with a
 * transform, or the column group's widths, inside one animation frame, and
 * the document changes once, on release, in one transaction (one undo).
 * The handles are for a pointer; the toolbar, the context menu and the keyboard
 * (Tab in the last cell, Alt+arrows) do everything they do, so they are hidden
 * from assistive technology. What they look like is `editor.css`'s ("Table
 * handles"), keyed on the classes and data attributes set here.
 */

const SNAP = 16
const MIN_COLUMN = 40

/** The reading grid's three widths, in pixels, measured from its tracks. */
export interface Tracks {
  readonly content: number
  readonly wide: number
  readonly full: number
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

/**
 * Where a drag lands: the line the dragged line's middle is over, the first
 * line for anywhere before them and the last for anywhere after.
 */
export function dropIndex(starts: readonly number[], at: number): number {
  let index = 0
  starts.forEach((start, line) => {
    if (at >= start) index = line
  })
  return index
}

/** Where the border that puts a line at index `at` is: the line's leading edge, or the last one's trailing edge. */
export function borderAt(
  lines: readonly { readonly start: number; readonly size: number }[],
  at: number,
): number {
  const line = lines[at]
  if (line !== undefined) return line.start
  const last = lines.at(-1)
  return last === undefined ? 0 : last.start + last.size
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

/** The cells of the table's first row, which stand for its columns. */
function columnCells(table: HTMLTableElement): HTMLTableCellElement[] {
  /* v8 ignore next -- a table the handles belong to always has a first row. */
  return [...(table.rows[0]?.cells ?? [])]
}

export class TableHandles {
  readonly layer: HTMLElement
  private readonly grips: Record<Axis, HTMLButtonElement[]> = { row: [], column: [] }
  /** `inserts[axis][at]` puts a new line at index `at`, so there is one more than there are lines. */
  private readonly inserts: Record<Axis, HTMLButtonElement[]> = { row: [], column: [] }
  private readonly borders: HTMLElement[] = []
  private readonly corner: HTMLButtonElement
  private readonly edge: HTMLElement
  private readonly readout: HTMLElement
  private readonly ghost: HTMLElement
  private readonly line: HTMLElement
  private frame = 0
  private readonly onScroll = (): void => {
    this.schedule()
  }

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
    this.corner = element('button', 'table-grip')
    this.corner.type = 'button'
    this.corner.tabIndex = -1
    this.corner.dataset['axis'] = 'table'
    this.edge = element('div', 'table-width-handle')
    this.readout = element('div', 'table-readout')
    this.readout.hidden = true
    this.ghost = element('div', 'table-drag-ghost')
    this.line = element('div', 'table-drop-line')
    this.layer.append(this.corner, this.edge, this.readout, this.ghost, this.line)
    this.corner.addEventListener('pointerdown', (event) => {
      if (event.button === 0) this.selectAll(event)
    })
    this.layer.addEventListener('contextmenu', (event) => {
      this.select(event)
    })
    this.edge.addEventListener('pointerdown', (event) => {
      this.resizeWidth(event)
    })
    this.scroller.addEventListener('scroll', this.onScroll, { passive: true })
  }

  /** Brings the handles in line with the table's shape, then places them. */
  render(node: PMNode): void {
    const map = TableMap.get(node)
    this.count('column', map.width)
    this.count('row', map.height)
    this.countInserts('column', map.width + 1)
    this.countInserts('row', map.height + 1)
    while (this.borders.length > Math.max(0, map.width - 1)) this.borders.pop()?.remove()
    while (this.borders.length < map.width - 1) {
      const border = element('div', 'table-column-border')
      const index = this.borders.length
      border.addEventListener('pointerdown', (event) => {
        this.resizeColumns(event, border, index)
      })
      this.borders.push(border)
      this.layer.append(border)
    }
    this.markSelection()
    this.schedule()
  }

  /** The corner pressed: every cell selected, so the table can be copied, cut or cleared whole. */
  private selectAll(event: PointerEvent): void {
    const pos = this.tablePos()
    if (pos === undefined) return
    // The caret stays where it was until the selection is made, as for a grip.
    event.preventDefault()
    selectTable(pos)(this.view.state, this.view.dispatch)
    this.view.focus()
  }

  /** What of this table is selected as a whole: all of it, or whole rows or columns. */
  private selected(): { readonly whole: boolean; readonly lines: LineSelection | undefined } {
    const { state } = this.view
    const context = tableContext(state)
    const own = context !== undefined && context.tablePos === this.tablePos()
    return {
      whole: own && wholeTableSelected(context, state.selection),
      lines: own ? selectedLines(context, state.selection) : undefined,
    }
  }

  /**
   * A right-click on a handle is a menu about what the handle stands for: the
   * table for the corner, the row or column for a grip. It selects that, unless it
   * is selected already (a grip within several rows selected keeps all of them),
   * so the menu opens on a selection and does not take one away.
   */
  private select(event: MouseEvent): void {
    /* v8 ignore next -- the layer is made of elements, so a contextmenu on it targets one. */
    const handle = event.target instanceof Element ? event.target.closest('.table-grip') : null
    const pos = this.tablePos()
    if (!(handle instanceof HTMLElement) || pos === undefined) return
    const { state, dispatch } = this.view
    const { whole, lines } = this.selected()
    const { axis } = handle.dataset
    if (axis === 'table') {
      if (!whole) selectTable(pos)(state, dispatch)
      return
    }
    /* v8 ignore next -- every grip is made with an axis. */
    if (axis !== 'row' && axis !== 'column') return
    const index = Number(handle.dataset['index'])
    const covered = lines?.axis === axis && index >= lines.from && index < lines.to
    if (!covered) selectLine(axis, index, pos)(state, dispatch)
  }

  /** The grips of a whole row or column that is selected say so: that is what the toolbar is about. */
  private markSelection(): void {
    const { whole, lines } = this.selected()
    if (whole) this.corner.dataset['state'] = 'selected'
    else delete this.corner.dataset['state']
    for (const axis of ['row', 'column'] as const) {
      this.grips[axis].forEach((grip, index) => {
        const selected = lines?.axis === axis && index >= lines.from && index < lines.to
        if (selected) grip.dataset['state'] = 'selected'
        else delete grip.dataset['state']
      })
    }
  }

  private count(axis: Axis, wanted: number): void {
    const list = this.grips[axis]
    while (list.length > wanted) list.pop()?.remove()
    while (list.length < wanted) {
      const index = list.length
      const grip = element('button', 'table-grip')
      grip.type = 'button'
      grip.tabIndex = -1
      grip.dataset['axis'] = axis
      grip.dataset['index'] = String(index)
      grip.addEventListener('pointerdown', (event) => {
        if (event.button === 0) this.drag(event, grip, axis, index)
      })
      list.push(grip)
      this.layer.append(grip)
    }
  }

  /** One "+" for every border between lines and one for each outer edge: a line more than there are. */
  private countInserts(axis: Axis, wanted: number): void {
    const list = this.inserts[axis]
    while (list.length > wanted) list.pop()?.remove()
    while (list.length < wanted) {
      const at = list.length
      const insert = element('button', 'table-insert')
      insert.type = 'button'
      insert.tabIndex = -1
      insert.dataset['axis'] = axis
      // Pressing must not move the caret out of the table, as it would if the button took focus.
      insert.addEventListener('pointerdown', (event) => {
        event.preventDefault()
      })
      insert.addEventListener('click', () => {
        this.insertAt(axis, at)
      })
      list.push(insert)
      this.layer.append(insert)
    }
    // Nothing goes above the header row, so that border has no "+". Nor does the
    // edge before the first column, which is the corner's (a column grip's
    // toolbar inserts one there).
    const above = this.inserts.row[0]
    if (above !== undefined) above.hidden = this.headerRowFirst()
    const before = this.inserts.column[0]
    /* v8 ignore else -- a table has a first column, so there are at least two column borders. */
    if (before !== undefined) before.hidden = true
  }

  /** Whether the table's first row is its header row, which GFM keeps first. */
  private headerRowFirst(): boolean {
    const pos = this.tablePos()
    /* v8 ignore next -- the handles are rendered in the document, where the table has a position. */
    const context = pos === undefined ? undefined : tableAt(this.view.state, pos)
    return context !== undefined && headersOf(context).row
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

  private schedule(): void {
    if (this.frame !== 0) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.place()
    })
  }

  /** Every read first, then every write: the grips follow the cells. */
  private place(): void {
    const rows = [...this.table.rows]
    const cells = columnCells(this.table)
    const scrollLeft = this.scroller.scrollLeft
    const columns = cells.map((cell) => ({
      start: cell.offsetLeft - scrollLeft,
      size: cell.offsetWidth,
    }))
    const lines = rows.map((row) => ({ start: row.offsetTop, size: row.offsetHeight }))
    const width = this.table.offsetWidth
    const height = this.table.offsetHeight
    const { offsetLeft, offsetTop } = this.table
    this.layer.style.setProperty('--table-width', `${width}px`)
    this.layer.style.setProperty('--table-height', `${height}px`)
    const across = columns.map(({ start, size }) => ({ start: offsetLeft + start, size }))
    const down = lines.map(({ start, size }) => ({ start: offsetTop + start, size }))
    across.forEach(({ start, size }, index) => {
      this.grips.column[index]?.style.setProperty('--start', `${start}px`)
      this.grips.column[index]?.style.setProperty('--size', `${size}px`)
      this.borders[index]?.style.setProperty('--start', `${start + size}px`)
    })
    down.forEach(({ start, size }, index) => {
      this.grips.row[index]?.style.setProperty('--start', `${start}px`)
      this.grips.row[index]?.style.setProperty('--size', `${size}px`)
    })
    this.inserts.column.forEach((insert, at) => {
      insert.style.setProperty('--start', `${borderAt(across, at)}px`)
    })
    this.inserts.row.forEach((insert, at) => {
      insert.style.setProperty('--start', `${borderAt(down, at)}px`)
    })
    this.edge.style.setProperty(
      '--start',
      `${offsetLeft + Math.min(width, this.scroller.clientWidth)}px`,
    )
  }

  private tablePos(): number | undefined {
    return this.getPos()
  }

  /** A "+" pressed: a line at this border, the caret in its first cell. One undo step. */
  private insertAt(axis: Axis, at: number): void {
    const pos = this.tablePos()
    if (pos === undefined) return
    insertLine(axis, at, pos)(this.view.state, this.view.dispatch)
    this.view.focus()
  }

  /**
   * A grip pressed: a click selects its row or column; a drag moves it. The
   * extents are read once, at the press; the ghost moves by transform.
   */
  private drag(event: PointerEvent, grip: HTMLElement, axis: Axis, index: number): void {
    const pos = this.tablePos()
    if (pos === undefined) return
    event.preventDefault()
    grip.setPointerCapture?.(event.pointerId)
    const rows = [...this.table.rows]
    const extents =
      axis === 'row'
        ? rows.map((row) => ({
            start: this.table.offsetTop + row.offsetTop,
            size: row.offsetHeight,
          }))
        : columnCells(this.table).map((cell) => ({
            start: this.table.offsetLeft + cell.offsetLeft,
            size: cell.offsetWidth,
          }))
    const origin = axis === 'row' ? event.clientY : event.clientX
    /* v8 ignore next -- a grip stands for a line the table has. */
    const own = extents[index] ?? { start: 0, size: 0 }
    let target = index
    let moved = false
    this.ghost.dataset['axis'] = axis
    this.line.dataset['axis'] = axis
    const move = (next: PointerEvent): void => {
      const delta = (axis === 'row' ? next.clientY : next.clientX) - origin
      if (!moved && Math.abs(delta) < 4) return
      moved = true
      this.dragging(axis)
      const at = own.start + own.size / 2 + delta
      target = dropIndex(
        extents.map((extent) => extent.start),
        at,
      )
      /* v8 ignore next -- `dropIndex` answers one of the lines. */
      const landing = extents[target] ?? own
      this.ghost.style.setProperty('--start', `${own.start + delta}px`)
      this.ghost.style.setProperty('--size', `${own.size}px`)
      this.line.style.setProperty(
        '--start',
        `${target > index ? landing.start + landing.size : landing.start}px`,
      )
    }
    const end = (): void => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', end)
      grip.removeEventListener('pointercancel', end)
      this.dragging(undefined)
      const { state, dispatch } = this.view
      if (!moved) selectLine(axis, index, pos)(state, dispatch)
      else if (target !== index) {
        ;(axis === 'row' ? moveRow : moveColumn)(index, target, pos)(state, dispatch)
      }
      this.view.focus()
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', end)
    grip.addEventListener('pointercancel', end)
  }

  /** A border dragged: its two columns resize as proportions, previewed in the column group. */
  private resizeColumns(event: PointerEvent, handle: HTMLElement, border: number): void {
    const pos = this.tablePos()
    if (pos === undefined) return
    event.preventDefault()
    handle.setPointerCapture?.(event.pointerId)
    const widths = columnCells(this.table).map((cell) => cell.offsetWidth)
    const total = widths.reduce((sum, each) => sum + each, 0)
    const cols = () => [...this.table.querySelectorAll<HTMLElement>(':scope > colgroup > col')]
    let current = widths
    this.dragging('border')
    const preview = (next: readonly number[]): void => {
      const existing = cols()
      if (existing.length !== next.length) {
        const group = this.table.querySelector(':scope > colgroup')
        group?.replaceChildren(...next.map(() => document.createElement('col')))
        this.table.classList.add('table-proportional')
      }
      const widthOf = (index: number): number => {
        /* v8 ignore next -- there is a width for every column the table has. */
        return ((next[index] ?? 0) / total) * 100
      }
      cols().forEach((col, index) => {
        col.style.width = `${widthOf(index)}%`
      })
      const share = (index: number): number => Math.round(widthOf(index))
      this.readout.textContent = `${share(border)}% · ${share(border + 1)}%`
      this.readout.hidden = false
    }
    const move = (next: PointerEvent): void => {
      current = resized(widths, border, next.clientX - event.clientX)
      preview(current)
    }
    const end = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      this.dragging(undefined)
      this.readout.hidden = true
      const { state, dispatch } = this.view
      if (current !== widths)
        setTableAttributeAt(pos, 'columns', proportionsOf(current))(state, dispatch)
      this.view.focus()
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  /** The trailing edge dragged: the table's width, snapped to the grid's tracks. */
  private resizeWidth(event: PointerEvent): void {
    const pos = this.tablePos()
    const block = this.layer.closest('.table-block')
    const grid = this.view.dom
    if (pos === undefined || !(block instanceof HTMLElement)) return
    const tracks = tracksOf(getComputedStyle(grid).gridTemplateColumns)
    if (tracks === undefined) return
    event.preventDefault()
    this.edge.setPointerCapture?.(event.pointerId)
    const start = block.offsetWidth
    let chosen = widthFor(start, tracks)
    this.dragging('width')
    const move = (next: PointerEvent): void => {
      const width = start + next.clientX - event.clientX
      chosen = widthFor(width, tracks)
      this.readout.textContent = chosen.label
      this.readout.hidden = false
      this.edge.style.setProperty('--start', `${this.table.offsetLeft + width}px`)
    }
    const end = (): void => {
      this.edge.removeEventListener('pointermove', move)
      this.edge.removeEventListener('pointerup', end)
      this.edge.removeEventListener('pointercancel', end)
      this.dragging(undefined)
      this.readout.hidden = true
      const { state, dispatch } = this.view
      setTableAttributeAt(pos, 'width', chosen.value)(state, dispatch)
      this.schedule()
      this.view.focus()
    }
    this.edge.addEventListener('pointermove', move)
    this.edge.addEventListener('pointerup', end)
    this.edge.addEventListener('pointercancel', end)
  }

  destroy(): void {
    cancelAnimationFrame(this.frame)
    this.scroller.removeEventListener('scroll', this.onScroll)
  }
}
