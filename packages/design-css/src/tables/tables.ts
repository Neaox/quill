import type { SortDirection, SortEntry } from './sort.ts'
import { nextDirection, sortRows } from './sort.ts'
import { addTableViewer } from './table-viewer.ts'

/**
 * The reader's table tools (ADR-040): a header row that stays in view while
 * the page scrolls, click-to-sort, and the "more this way" shadows where the
 * browser cannot draw them from CSS alone.
 *
 * **Why cloned rows.** A table wider than its column scrolls sideways in
 * its `.table-scroll`, and an element with `overflow-x: auto` is a scroll
 * container on both axes, so `position: sticky` on its header cells sticks
 * to *it*, which never scrolls vertically, and not to the page. That is the
 * bug behind Confluence's broken sticky headers. So the header that sticks
 * is a copy, hung in a sticky strip in the `.table-block` *around* the
 * scroller, which does scroll with the page: its column widths are copied
 * from the real header, and it is moved sideways with the scroller. It is
 * hidden from assistive technology and from the tab order; the real `thead`
 * stays the accessible one, and a click on the copy is a click on the real
 * header's button. A footer (`tfoot`) hangs the same way from the bottom of
 * the page. Both stop at the page's own sticky chrome: `--sticky-chrome-top`
 * and `--sticky-chrome-bottom`, which each shell sets from its bars.
 *
 * **Full screen.** Every table opens in the viewer a diagram opens in
 * (`table-viewer.ts`).
 *
 * **Sorting** reorders the rendered rows only; the document is never
 * changed. Ascending, descending, then the order as written; `aria-sort` on
 * the header, and the change said in a polite live region.
 *
 * **Performance.** One scroll listener (captured, passive) and one
 * ResizeObserver for every table under `root`, and at most one frame of
 * work per frame: every layout read for every table first, then every write,
 * so a page of tables never thrashes. Nothing is read from a row until a
 * reader first sorts by its column.
 *
 * Enhancement only. Without this script a table is still a table: it
 * scrolls, the stylesheet freezes its first column on a narrow screen and
 * stacks it when asked, and nothing is missing but sorting and the hanging
 * header. Framework-free, like the lightbox, so the signed-in application and
 * the public site's bundled reader script (`../reader/reader.ts`) share it.
 */

/** What the enhancer needs from a browser, injected so it can be tested without one. */
export interface TableEnvironment {
  /** Runs `callback` before the next paint. */
  readonly requestFrame: (callback: () => void) => void
  /** The height of the viewport, which decides whether a header needs to stay in view. */
  readonly viewportHeight: () => number
  /** Calls `callback` when the viewport is resized; returns what stops it. */
  readonly onViewportResize: (callback: () => void) => () => void
  /** A ResizeObserver, where the browser has one. */
  readonly observeResize: ((callback: () => void) => ResizeWatcher) | undefined
  /** Whether CSS scroll-driven animations draw the scroll shadows (`prose.css`). */
  readonly scrollTimelines: boolean
  /** The language rows are sorted in; the browser's when undefined. */
  readonly locale: string | undefined
}

export interface ResizeWatcher {
  observe(target: Element): void
  disconnect(): void
}

/**
 * The parts of a window the enhancer uses. `ResizeObserver` and `CSS` are
 * globals the DOM library does not declare on `Window`, and either may be
 * missing in an older or headless browser.
 */
export interface TableWindow {
  readonly document: Document
  readonly innerHeight: number
  readonly ResizeObserver?: typeof ResizeObserver | undefined
  readonly CSS?: { supports(condition: string): boolean } | undefined
  requestAnimationFrame(callback: FrameRequestCallback): number
  addEventListener(type: 'resize', listener: () => void, options: AddEventListenerOptions): void
  removeEventListener(type: 'resize', listener: () => void): void
}

/** The real browser, as the enhancer uses it. */
export function browserTableEnvironment(view: TableWindow): TableEnvironment {
  const { ResizeObserver: Observer } = view
  return {
    requestFrame: (callback) => {
      view.requestAnimationFrame(callback)
    },
    viewportHeight: () => view.innerHeight,
    onViewportResize: (callback) => {
      view.addEventListener('resize', callback, { passive: true })
      return () => view.removeEventListener('resize', callback)
    },
    /* v8 ignore next 2 -- every supported browser has ResizeObserver; jsdom has none. */
    observeResize:
      typeof Observer === 'function' ? (callback) => new Observer(callback) : undefined,
    scrollTimelines: view.CSS?.supports?.('animation-timeline: scroll()') === true,
    locale: view.document.documentElement.lang || undefined,
  }
}

/** Which edge a hanging copy sticks to: the header's top, or the footer's bottom. */
type Edge = 'head' | 'foot'

/** A copy of the header or footer rows, hung beside the scroller. */
interface Strip {
  readonly edge: Edge
  readonly root: HTMLElement
  readonly table: HTMLTableElement
  /** Each column of the copy, with the real cell it takes its width from. */
  readonly columns: readonly { readonly col: HTMLTableColElement; readonly cell: Element }[]
  /** The copy's first-column cells, held still while a frozen first column is. */
  readonly first: readonly HTMLElement[]
}

/**
 * The sticky strip at the foot of a block: the pinned scrollbar, and under it
 * the footer's copy when there is one. The scrollbar is a thin proxy scroller
 * kept level with the real one both ways, so a wide, tall table can be
 * scrolled sideways from anywhere in it, not only from its last row.
 */
interface Bottom {
  readonly root: HTMLElement
  readonly stack: HTMLElement
  readonly proxy: HTMLElement
  readonly track: HTMLElement
}

interface Block {
  readonly block: HTMLElement
  readonly scroller: HTMLElement
  readonly table: HTMLTableElement
  readonly head: HTMLTableSectionElement | null
  readonly foot: HTMLTableSectionElement | null
  readonly bottom: Bottom
  sort: Sorting | null
  /** The hanging copies, one per edge the table may freeze. */
  strips: Partial<Record<Edge, Strip>>
  /** The last state written, so a frame writes only what changed. */
  written: Written
}

interface Written {
  /** Whether the scroller is a tab stop: only while there is something to scroll. */
  readonly overflows: boolean
  readonly stuck: boolean
  readonly footStuck: boolean
  /** Whether the pinned scrollbar shows: the table overflows and its own bar is out of view. */
  readonly bar: boolean
  readonly overflowStart: boolean
  readonly overflowEnd: boolean
  readonly scrollLeft: number
}

/** What one frame reads from a block before anything is written. */
interface Reading {
  readonly scrollLeft: number
  readonly overflowStart: boolean
  readonly overflowEnd: boolean
  readonly top: number
  readonly bottom: number
  readonly overflows: boolean
  readonly scrollerBottom: number
  /** The real scrollbar's height, which nothing hung over the table may cover. */
  readonly barHeight: number
  readonly headTop: number
  readonly headHeight: number
  readonly footBottom: number
  readonly footHeight: number
  readonly stickyTop: number
  readonly stickyBottom: number
  readonly viewport: number
  /** Present only when sizes were measured this frame. */
  readonly layout?: Layout
}

interface Layout {
  readonly freeze: Readonly<Record<Edge, boolean>>
  readonly tableWidth: number
  readonly scrollWidth: number
  readonly columns: readonly { readonly col: HTMLTableColElement; readonly width: number }[]
  readonly firstColumnWidth: number
  readonly firstColumnSticky: boolean
}

interface Sorting {
  readonly sortBy: (column: number) => void
  readonly undo: () => void
}

const INITIAL: Written = {
  overflows: true,
  stuck: false,
  footStuck: false,
  bar: false,
  overflowStart: false,
  overflowEnd: false,
  scrollLeft: 0,
}

const EDGES = ['head', 'foot'] as const

/** The freeze part each edge answers to. */
const PART: Readonly<Record<Edge, string>> = { head: 'header', foot: 'footer' }

/** A scroller this close to an edge counts as at it, absorbing sub-pixel scroll positions. */
const EDGE = 1

/** The parts the author froze, or undefined to decide automatically. */
function frozenParts(block: HTMLElement): readonly string[] | undefined {
  return block.dataset['freeze']?.split(' ')
}

/** The cells of a section's first row. */
function firstRowCells(section: HTMLTableSectionElement): readonly HTMLTableCellElement[] {
  return [...section.querySelectorAll<HTMLTableCellElement>(':scope > tr:first-child > *')]
}

function sectionOf(entry: Block, edge: Edge): HTMLTableSectionElement | null {
  return edge === 'head' ? entry.head : entry.foot
}

/* --- Sorting ---------------------------------------------------------------- */

function announcer(block: HTMLElement): HTMLElement {
  const status = block.ownerDocument.createElement('p')
  status.className = 'table-announcement'
  status.setAttribute('role', 'status')
  block.append(status)
  return status
}

/** What can take focus or a click of its own, which a button must never hold. */
const INTERACTIVE = 'a[href], button, input, select, textarea, [tabindex]'

interface SortControl {
  readonly button: HTMLButtonElement
  /** Puts the header cell back as it was rendered. */
  readonly restore: () => void
}

/**
 * A header cell's sort button. A header of plain words becomes the button,
 * so its name is what a reader clicks and hears. A header holding a link or a
 * footnote reference keeps it where it is, and the button is the arrows
 * alone beside it, named "Sort by …": a link inside a button would sort as
 * well as follow. An empty header gets a button named by its position.
 */
function sortButton(doc: Document, cell: HTMLTableCellElement, column: number): SortControl {
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = 'table-sort'
  const icon = doc.createElement('span')
  icon.className = 'table-sort-icon'
  icon.setAttribute('aria-hidden', 'true')
  const name = cell.textContent.trim()
  if (name === '' || cell.querySelector(INTERACTIVE) !== null) {
    button.classList.add('table-sort-beside')
    button.setAttribute('aria-label', `Sort by ${name === '' ? `column ${column + 1}` : name}`)
    button.append(icon)
    cell.append(button)
    return { button, restore: () => button.remove() }
  }
  button.append(...cell.childNodes, icon)
  cell.append(button)
  return {
    button,
    restore: () => {
      icon.remove()
      cell.replaceChildren(...button.childNodes)
    },
  }
}

/**
 * Gives every header cell a sort button. Null when the table cannot be
 * sorted: its author turned sorting off, it has no header row, or it has
 * fewer than two rows. Only the body sorts: a footer's totals stay at the foot.
 */
function makeSortable(entry: Block, collator: Intl.Collator, sorted: () => void): Sorting | null {
  const { block, table, head } = entry
  const body = table.querySelector<HTMLTableSectionElement>(':scope > tbody')
  if (block.dataset['sort'] === 'off' || body === null || head === null) return null
  const rows = [...body.rows]
  if (rows.length < 2) return null

  const doc = block.ownerDocument
  const status = announcer(block)
  const cells = firstRowCells(head)
  // Read from the rows only when a reader first sorts by a column.
  const entries = new Map<number, readonly SortEntry<HTMLTableRowElement>[]>()
  const entriesOf = (column: number): readonly SortEntry<HTMLTableRowElement>[] => {
    const known = entries.get(column)
    if (known !== undefined) return known
    const found = rows.map((row) => ({
      item: row,
      text: row.cells[column]?.textContent.trim() ?? '',
    }))
    entries.set(column, found)
    return found
  }
  let current: { readonly column: number; readonly direction: SortDirection } | undefined

  const sortBy = (column: number): void => {
    const direction = nextDirection(current?.column === column ? current.direction : undefined)
    current = direction === undefined ? undefined : { column, direction }
    body.replaceChildren(
      ...(direction === undefined ? rows : sortRows(entriesOf(column), direction, collator)),
    )
    for (const [index, cell] of cells.entries()) {
      if (index === column && direction !== undefined) cell.setAttribute('aria-sort', direction)
      else cell.removeAttribute('aria-sort')
      if (index === column) {
        const name = cell.textContent.trim()
        status.textContent =
          direction === undefined
            ? 'Rows in their original order'
            : `Sorted by ${name}, ${direction}`
      }
    }
    sorted()
  }

  const controls = cells.map((cell, column) => {
    const control = sortButton(doc, cell, column)
    control.button.addEventListener('click', () => sortBy(column))
    return { cell, ...control }
  })
  block.dataset['sortable'] = 'true'

  return {
    sortBy,
    undo: () => {
      body.replaceChildren(...rows)
      for (const { cell, restore } of controls) {
        restore()
        cell.removeAttribute('aria-sort')
      }
      status.remove()
      delete block.dataset['sortable']
    },
  }
}

/* --- The hanging header and footer ------------------------------------------ */

/**
 * A copy of the header or the footer, in a sticky strip just before or after
 * the scroller. It is built for every table whose header or footer may
 * freeze, and shown only while that edge is frozen and the real rows have
 * scrolled out of view (`data-sticky-head`, `data-stuck`, and their footer
 * twins; `prose.css`).
 */
function buildStrip(entry: Block, edge: Edge, section: HTMLTableSectionElement): Strip {
  const { block, sort } = entry
  const doc = block.ownerDocument
  const root = doc.createElement('div')
  root.className = `table-sticky-${edge}`
  root.setAttribute('aria-hidden', 'true')
  const clip = doc.createElement('div')
  clip.className = 'table-sticky-clip'
  const table = doc.createElement('table')
  const group = doc.createElement('colgroup')
  const copy = doc.createElement(edge === 'head' ? 'thead' : 'tfoot')
  copy.append(...[...section.rows].map((row) => row.cloneNode(true)))
  const columns = firstRowCells(section).map((cell) => ({ col: doc.createElement('col'), cell }))
  group.append(...columns.map(({ col }) => col))
  // Hidden from assistive technology, so out of the tab order too, and with
  // no ids to duplicate (a footnote reference in a header carries one).
  for (const element of copy.querySelectorAll('[id]')) element.removeAttribute('id')
  // Out of the tab order entirely: links and footnote references too, or
  // Tab would reach invisible duplicates while the header is stuck.
  for (const element of copy.querySelectorAll<HTMLElement>(INTERACTIVE)) element.tabIndex = -1
  const buttons = [...copy.querySelectorAll('button')]
  // A click on the copy sorts as the real header does, so the order, its
  // state and its announcement live in one place.
  if (sort !== null) {
    for (const [column, button] of buttons.entries()) {
      button.addEventListener('click', () => sort.sortBy(column))
    }
  }
  table.append(group, copy)
  clip.append(table)
  root.append(clip)
  if (edge === 'head') entry.scroller.before(root)
  else entry.bottom.stack.append(root)
  const first = [...copy.querySelectorAll<HTMLElement>(':scope > tr > :first-child')]
  return { edge, root, table, columns, first }
}

/** Builds the copy for an edge the author did not rule out, when the table has that edge. */
function buildStrips(entry: Block): void {
  const parts = frozenParts(entry.block)
  for (const edge of EDGES) {
    const section = sectionOf(entry, edge)
    if (section !== null && parts?.includes(PART[edge]) !== false) {
      entry.strips[edge] = buildStrip(entry, edge, section)
    }
  }
}

function removeStrips(entry: Block): void {
  for (const edge of EDGES) entry.strips[edge]?.root.remove()
  entry.strips = {}
}

/** The pinned scrollbar's strip, after the scroller; hidden until it is needed. */
function buildBottom(doc: Document): Bottom {
  const root = doc.createElement('div')
  root.className = 'table-sticky-bottom'
  const stack = doc.createElement('div')
  stack.className = 'table-sticky-stack'
  // The real scroller is the one a keyboard and a screen reader use; this
  // one is for a pointer, and hidden from everything else.
  const proxy = doc.createElement('div')
  proxy.className = 'table-scrollbar'
  proxy.setAttribute('aria-hidden', 'true')
  proxy.tabIndex = -1
  const track = doc.createElement('div')
  track.className = 'table-scrollbar-track'
  proxy.append(track)
  stack.append(proxy)
  root.append(stack)
  return { root, stack, proxy, track }
}

/* --- One frame -------------------------------------------------------------- */

function px(value: string): number {
  return Number.parseFloat(value) || 0
}

function read(
  entry: Block,
  view: Window,
  environment: TableEnvironment,
  measure: boolean,
): Reading {
  const { block, scroller, table, head, foot, strips, bottom } = entry
  const scrollLeft = scroller.scrollLeft
  const extent = scroller.scrollWidth - scroller.clientWidth
  const bounds = block.getBoundingClientRect()
  const scrollerBounds = scroller.getBoundingClientRect()
  const headBounds = head?.getBoundingClientRect()
  const footBounds = foot?.getBoundingClientRect()
  const viewport = environment.viewportHeight()
  const reading = {
    scrollLeft,
    overflowStart: scrollLeft > EDGE,
    overflowEnd: scrollLeft < extent - EDGE,
    top: bounds.top,
    bottom: bounds.bottom,
    overflows: extent > EDGE,
    scrollerBottom: scrollerBounds.bottom,
    barHeight: scroller.offsetHeight - scroller.clientHeight,
    headTop: headBounds?.top ?? 0,
    headHeight: headBounds?.height ?? 0,
    footBottom: footBounds?.bottom ?? 0,
    footHeight: footBounds?.height ?? 0,
    stickyTop: strips.head === undefined ? 0 : px(view.getComputedStyle(strips.head.root).top),
    stickyBottom: px(view.getComputedStyle(bottom.root).bottom),
    viewport,
  }
  if (!measure) return reading
  const parts = frozenParts(block)
  const tableBounds = table.getBoundingClientRect()
  const tall = tableBounds.height > viewport
  // The first cell of the first row: one match, so the query stops there.
  const firstColumn = [
    table.querySelector<HTMLElement>(':scope > :is(thead, tbody, tfoot) > tr > :first-child'),
  ].filter((cell): cell is HTMLElement => cell !== null)
  const freezes = (edge: Edge): boolean =>
    strips[edge] !== undefined && (parts === undefined ? tall : true)
  return {
    ...reading,
    layout: {
      freeze: { head: freezes('head'), foot: freezes('foot') },
      tableWidth: tableBounds.width,
      scrollWidth: scroller.scrollWidth,
      columns: EDGES.flatMap((edge) => strips[edge]?.columns ?? []).map(({ col, cell }) => ({
        col,
        width: cell.getBoundingClientRect().width,
      })),
      firstColumnWidth: firstColumn.reduce((_, cell) => cell.getBoundingClientRect().width, 0),
      firstColumnSticky: firstColumn.some(
        (cell) => view.getComputedStyle(cell).position === 'sticky',
      ),
    },
  }
}

function writeLayout(entry: Block, layout: Layout): void {
  const { block, strips } = entry
  block.toggleAttribute('data-sticky-head', layout.freeze.head)
  block.toggleAttribute('data-sticky-foot', layout.freeze.foot)
  block.style.setProperty(
    '--table-frozen-width',
    layout.firstColumnSticky ? `${layout.firstColumnWidth}px` : '0px',
  )
  for (const { col, width } of layout.columns) col.style.width = `${width}px`
  entry.bottom.track.style.width = `${layout.scrollWidth}px`
  for (const edge of EDGES) {
    const strip = strips[edge]
    if (strip === undefined) continue
    strip.table.style.width = `${layout.tableWidth}px`
    for (const cell of strip.first) cell.toggleAttribute('data-frozen', layout.firstColumnSticky)
  }
}

function write(entry: Block, reading: Reading, environment: TableEnvironment): void {
  const { block } = entry
  if (reading.layout !== undefined) writeLayout(entry, reading.layout)
  const floor = reading.viewport - reading.stickyBottom
  const next: Written = {
    // The real header has gone under the top chrome while the table is still in
    // view, and the copy would not cover the table's own scrollbar.
    stuck:
      block.hasAttribute('data-sticky-head') &&
      reading.headTop < reading.stickyTop &&
      reading.scrollerBottom - reading.barHeight > reading.stickyTop + reading.headHeight,
    // The real footer is below the bottom chrome while the table is already in view.
    footStuck:
      block.hasAttribute('data-sticky-foot') &&
      reading.footBottom > floor &&
      reading.top < floor - reading.footHeight,
    // The table scrolls sideways, its own bar is below the floor, and the
    // table is in view above it.
    bar: reading.overflows && reading.scrollerBottom > floor && reading.top < floor,
    overflows: reading.overflows,
    overflowStart: reading.overflowStart,
    overflowEnd: reading.overflowEnd,
    scrollLeft: reading.scrollLeft,
  }
  const before = entry.written
  if (next.stuck !== before.stuck) block.toggleAttribute('data-stuck', next.stuck)
  if (next.footStuck !== before.footStuck) {
    block.toggleAttribute('data-stuck-foot', next.footStuck)
  }
  if (next.bar !== before.bar) block.toggleAttribute('data-bar', next.bar)
  // A table that fits needs no keyboard scrolling, so it is no tab stop.
  if (next.overflows !== before.overflows) entry.scroller.tabIndex = next.overflows ? 0 : -1
  if (!environment.scrollTimelines) {
    if (next.overflowStart !== before.overflowStart) {
      block.toggleAttribute('data-overflow-start', next.overflowStart)
    }
    if (next.overflowEnd !== before.overflowEnd) {
      block.toggleAttribute('data-overflow-end', next.overflowEnd)
    }
  }
  if (reading.layout !== undefined || next.scrollLeft !== before.scrollLeft) {
    // Level with the real scroller; set only when it differs, so the two
    // never chase each other's scroll events.
    if (entry.bottom.proxy.scrollLeft !== next.scrollLeft) {
      entry.bottom.proxy.scrollLeft = next.scrollLeft
    }
    for (const edge of EDGES) {
      const strip = entry.strips[edge]
      if (strip === undefined) continue
      strip.table.style.transform = `translateX(${-next.scrollLeft}px)`
      for (const cell of strip.first) {
        cell.style.transform = cell.hasAttribute('data-frozen')
          ? `translateX(${next.scrollLeft}px)`
          : ''
      }
    }
  }
  entry.written = next
}

/* --- Wiring ----------------------------------------------------------------- */

const ENHANCED_ATTRIBUTES = [
  'data-enhanced',
  'data-sticky-head',
  'data-sticky-foot',
  'data-stuck',
  'data-stuck-foot',
  'data-overflow-start',
  'data-overflow-end',
  'data-bar',
] as const

/** Every table block under `root` not yet enhanced, with the parts the enhancer works on. */
function blocksUnder(root: ParentNode): Block[] {
  return [...root.querySelectorAll<HTMLElement>('.table-block:not([data-enhanced])')].flatMap(
    (block) => {
      const scroller = block.querySelector<HTMLElement>(':scope > .table-scroll')
      const table = scroller?.querySelector<HTMLTableElement>(':scope > table') ?? null
      if (scroller === null || table === null) return []
      return [
        {
          block,
          scroller,
          table,
          head: table.querySelector<HTMLTableSectionElement>(':scope > thead'),
          foot: table.querySelector<HTMLTableSectionElement>(':scope > tfoot'),
          bottom: buildBottom(block.ownerDocument),
          sort: null,
          strips: {},
          written: INITIAL,
        },
      ]
    },
  )
}

/**
 * Enhances every table block under `root`. Returns what takes it all away
 * again, leaving the rows in their written order.
 */
export function enhanceTables(
  root: Element | Document,
  environment?: TableEnvironment,
): () => void {
  const owner = 'documentElement' in root ? root : root.ownerDocument
  const view = owner.defaultView
  const blocks = blocksUnder(root)
  if (view === null || blocks.length === 0) return () => undefined
  const env = environment ?? browserTableEnvironment(view)
  const collator = new Intl.Collator(env.locale, { numeric: true, sensitivity: 'base' })

  let pending: 'none' | 'scroll' | 'measure' = 'none'
  const frame = (): void => {
    const measure = pending === 'measure'
    pending = 'none'
    // Every read for every table, then every write: one layout per frame.
    const readings = blocks.map((entry) => ({ entry, reading: read(entry, view, env, measure) }))
    for (const { entry, reading } of readings) write(entry, reading, env)
  }
  const schedule = (kind: 'scroll' | 'measure'): void => {
    const idle = pending === 'none'
    if (kind === 'measure' || idle) pending = kind
    if (idle) env.requestFrame(frame)
  }

  const extras: (() => void)[] = []
  for (const entry of blocks) {
    entry.block.dataset['enhanced'] = 'true'
    entry.sort = makeSortable(entry, collator, () => {
      // The copies show the header as it now is, sort state and all.
      removeStrips(entry)
      buildStrips(entry)
      schedule('measure')
    })
    entry.scroller.after(entry.bottom.root)
    buildStrips(entry)
    extras.push(addTableViewer(entry.block, entry.scroller))
  }

  // The pinned scrollbars, by element, so the one scroll listener can tell a
  // reader dragging one from the page scrolling.
  const proxies = new Map(blocks.map((entry) => [entry.bottom.proxy, entry]))
  const onScroll = (event: Event): void => {
    const pinned = event.target instanceof HTMLElement ? proxies.get(event.target) : undefined
    if (pinned !== undefined && pinned.scroller.scrollLeft !== pinned.bottom.proxy.scrollLeft) {
      pinned.scroller.scrollLeft = pinned.bottom.proxy.scrollLeft
    }
    schedule('scroll')
  }
  const onResize = (): void => schedule('measure')
  owner.addEventListener('scroll', onScroll, { capture: true, passive: true })
  const stopViewport = env.onViewportResize(onResize)
  const watcher = env.observeResize?.(onResize)
  for (const { table } of blocks) watcher?.observe(table)
  schedule('measure')

  return () => {
    owner.removeEventListener('scroll', onScroll, { capture: true })
    stopViewport()
    watcher?.disconnect()
    for (const undo of extras) undo()
    for (const entry of blocks) {
      entry.sort?.undo()
      removeStrips(entry)
      entry.bottom.root.remove()
      entry.scroller.tabIndex = 0
      for (const name of ENHANCED_ATTRIBUTES) entry.block.removeAttribute(name)
      entry.block.style.removeProperty('--table-frozen-width')
      if (entry.block.getAttribute('style') === '') entry.block.removeAttribute('style')
    }
  }
}
