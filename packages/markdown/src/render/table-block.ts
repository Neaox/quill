import type { Element, ElementContent, Properties } from 'hast'
import type { AlignType, PhrasingContent, Table, TableRow } from 'mdast'

import type { TableOptions } from '../directives/table.ts'
import { columnPercentages, renderedPercent, TABLE_FROZEN_PARTS } from '../directives/table.ts'
import type { State } from './hast-state.ts'
import type { ColumnShape } from './table-columns.ts'
import { columnLabels, columnShape } from './table-columns.ts'

/**
 * A table in its block (ADR-040), as the renderer emits it:
 *
 * ```html
 * <div class="table-block" data-…>                        the card, the grid item
 *   <div class="table-scroll" tabindex="0" role="group"  scrolls sideways, named by the
 *        aria-labelledby="caption.1">                    caption, or "Table" without one
 *     <table><caption id="caption.1">…</caption><colgroup>…</colgroup>
 *       <thead>…</thead><tbody>…</tbody><tfoot>…</tfoot></table>
 * ```
 *
 * The block sits outside the scroller so the reader script can hang copies of
 * the header and footer rows in it that stay in view while the page scrolls;
 * a sticky row inside the scroller would stick to the scroller instead.
 */

function element(tagName: string, properties: Properties, children: ElementContent[]): Element {
  return { type: 'element', tagName, properties, children }
}

/** How a shape of column is set (`table-columns.ts`), beyond its alignment. */
const SHAPE_CLASSES: Readonly<Record<ColumnShape, readonly string[]>> = {
  numeric: [],
  token: ['column-nowrap'],
  long: ['column-long'],
  text: [],
}

/**
 * A column's classes: the author's alignment, else `align-numeric` for a
 * column of numbers; then its shape's.
 */
export function columnClasses(align: AlignType | undefined, shape: ColumnShape): string[] {
  const authored = align !== null && align !== undefined
  const alignment = authored ? [`align-${align}`] : shape === 'numeric' ? ['align-numeric'] : []
  return [...alignment, ...SHAPE_CLASSES[shape]]
}

/**
 * The block's options as the data attributes the stylesheet and the reader
 * script read. Defaults are left unwritten, so a bare table and one wrapped
 * with no attributes render identically. The editor draws its table blocks
 * with the same attributes, so a table looks the same while it is written.
 */
export function tableBlockData(options: TableOptions): Readonly<Record<string, string>> {
  const data: Record<string, string> = {}
  const { width, freeze } = options
  if (typeof width === 'string') data['data-width'] = width
  if (typeof width === 'object') {
    data['data-width'] = 'percent'
    data['data-percent'] = String(renderedPercent(width.percent))
  }
  if (options.headers !== 'column') data['data-headers'] = options.headers
  if (freeze !== 'auto') {
    // Space-separated in a fixed order, so CSS can match a part with `~=`.
    const parts = TABLE_FROZEN_PARTS.filter((part) => freeze.includes(part))
    data['data-freeze'] = parts.length === 0 ? 'none' : parts.join(' ')
  }
  if (options.responsive === 'stack') data['data-responsive'] = 'stack'
  if (!options.sortable) data['data-sort'] = 'off'
  if (options.captionSide === 'bottom') data['data-caption'] = 'bottom'
  return data
}

function blockProperties(options: TableOptions): Properties {
  return { className: ['table-block'], ...tableBlockData(options) }
}

/** How a column is drawn: its classes and, stacked, its name. */
interface ColumnTreatment {
  readonly classes: readonly string[]
  readonly label: string | undefined
}

const PLAIN: ColumnTreatment = { classes: [], label: undefined }

/** Where a cell sits, which decides its element, scope and role. */
type CellKind = 'column-header' | 'row-header' | 'data'

const CELL_ROLES: Readonly<Record<CellKind, string>> = {
  'column-header': 'columnheader',
  'row-header': 'rowheader',
  data: 'cell',
}

function cellProperties(column: ColumnTreatment, kind: CellKind, stack: boolean): Properties {
  const properties: Properties =
    kind === 'data' ? {} : { scope: kind === 'column-header' ? 'col' : 'row' }
  if (column.classes.length > 0) properties['className'] = [...column.classes]
  const { label } = column
  if (stack && kind === 'data' && label !== undefined) properties['data-label'] = label
  // Restyled as cards, a table can lose its table semantics in some browsers;
  // explicit roles keep it a table to assistive technology.
  if (stack) properties['role'] = CELL_ROLES[kind]
  return properties
}

/**
 * Proportional column widths (`columns`), as a `<col width>` each: a
 * presentational hint, because the page's CSP admits no `style` attribute.
 * Only when there is one proportion for every column; otherwise none.
 */
function columnGroup(options: TableOptions, count: number): Element[] {
  const { columns } = options
  if (columns === undefined || columns.length !== count) return []
  const cols = columnPercentages(columns).map((width) => element('col', { width }, []))
  return [element('colgroup', {}, cols)]
}

export interface TableRendererContext {
  /** A body cell's content, its status line set apart (`handlers.ts`). */
  readonly cellContent: (state: State, children: readonly PhrasingContent[]) => ElementContent[]
}

/** Renders table blocks, numbering their captions' ids within one document. */
export function createTableRenderer(context: TableRendererContext) {
  let captions = 0

  const row = (
    state: State,
    node: TableRow,
    columns: readonly ColumnTreatment[],
    head: boolean,
    rowHeaders: boolean,
    stack: boolean,
  ): Element =>
    element(
      'tr',
      // A row's own `hProperties` are kept, as mdast-util-to-hast keeps them
      // for every node it draws itself: a comparison marks rows this way
      // (`diff/render.ts`), and a parsed document's rows carry none.
      { ...(stack ? { role: 'row' } : {}), ...node.data?.hProperties },
      state.wrap(
        node.children.map((cell, index) => {
          const kind: CellKind = head
            ? 'column-header'
            : rowHeaders && index === 0
              ? 'row-header'
              : 'data'
          return element(
            kind === 'data' ? 'td' : 'th',
            // `columns` has one entry for every cell of the widest row.
            /* v8 ignore next */
            cellProperties(columns[index] ?? PLAIN, kind, stack),
            head ? state.all(cell) : context.cellContent(state, cell.children),
          )
        }),
        true,
      ),
    )

  /**
   * A table in its block, with its options and, when it has one, its caption's
   * content: the `:::table[label]`, or the caption of a `:::figure` holding
   * only the table, which reads exactly the same (ADR-040).
   */
  return (
    state: State,
    node: Table,
    options: TableOptions,
    caption: readonly ElementContent[] = [],
  ): Element => {
    const align = node.align ?? []
    const stack = options.responsive === 'stack'
    const rowHeaders = options.headers !== 'column'
    const head = options.headers === 'row' ? undefined : node.children[0]
    const rest = options.headers === 'row' ? node.children : node.children.slice(1)
    const footer = Math.min(options.footer, rest.length)
    const body = rest.slice(0, rest.length - footer)
    const foot = rest.slice(rest.length - footer)
    const labels = columnLabels(head)
    const count = Math.max(...node.children.map((each) => each.children.length))
    const columns: ColumnTreatment[] = Array.from({ length: count }, (_, index) => ({
      classes: columnClasses(align[index], columnShape(rest, index)),
      label: head === undefined ? undefined : (labels[index] ?? ''),
    }))
    const group = stack ? { role: 'rowgroup' } : {}
    const section = (tagName: string, rows: readonly TableRow[], isHead: boolean): Element[] =>
      rows.length === 0
        ? []
        : [
            element(
              tagName,
              group,
              state.wrap(
                rows.map((each) => row(state, each, columns, isHead, rowHeaders, stack)),
                true,
              ),
            ),
          ]

    const captionId = caption.length === 0 ? undefined : `caption.${(captions += 1)}`
    const captionElement =
      captionId === undefined
        ? []
        : [
            element('caption', { id: captionId }, [
              element('span', { className: ['table-caption-text'] }, [...caption]),
            ]),
          ]
    const sections = [
      ...captionElement,
      ...columnGroup(options, count),
      ...section('thead', head === undefined ? [] : [head], true),
      ...section('tbody', body, false),
      ...section('tfoot', foot, false),
    ]
    const name: Properties =
      captionId === undefined ? { ariaLabel: 'Table' } : { ariaLabelledBy: [captionId] }
    const region = { className: ['table-scroll'], tabIndex: 0, role: 'group', ...name }
    const table = element('table', stack ? { role: 'table' } : {}, state.wrap(sections, true))
    return element('div', blockProperties(options), [element('div', region, [table])])
  }
}
