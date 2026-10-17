/**
 * A pasted grid, from Excel, Google Sheets, Numbers or another table, read
 * as GFM can hold it (ADR-040, phase 2).
 *
 * A spreadsheet's clipboard carries an HTML table and a tab-separated copy.
 * The HTML keeps bold, italic and links, so it is read first. It also carries
 * what makes Confluence refuse to sort: `colspan` and `rowspan`, often over
 * cells that were only empty neighbours (a phantom merge), plus hidden rows
 * and columns and empty trailing ones. GFM has no merged cells, so every span
 * is unwound here: the cell keeps its place, and the places it covered become
 * empty cells. A span over a cell that held words is a real merge, and the
 * caller says so; a span that covered nothing is unwound silently.
 */

export interface PastedCell {
  /** The cell's element, for its inline formatting; null for a cell a span covered. */
  readonly element: Element | null
  readonly text: string
}

export interface PastedGrid {
  readonly rows: readonly (readonly PastedCell[])[]
  /** Whether a merge with words in it was unwound, which the author should be told. */
  readonly unmerged: boolean
}

const EMPTY: PastedCell = { element: null, text: '' }

/** Hidden by the spreadsheet: a collapsed row or column it still copies. */
function isHidden(element: Element): boolean {
  const style = element.getAttribute('style') ?? ''
  return /display\s*:\s*none|mso-hide\s*:\s*all/iu.test(style) || element.hasAttribute('hidden')
}

function span(element: Element, name: 'colspan' | 'rowspan'): number {
  const value = Number(element.getAttribute(name) ?? '1')
  return Number.isInteger(value) && value > 1 ? Math.min(value, 1000) : 1
}

function textOf(element: Element): string {
  return element.textContent.replace(/\s+/gu, ' ').trim()
}

/** Drops empty rows and columns from the grid's end, which spreadsheets copy along. */
function trim(rows: PastedCell[][]): PastedCell[][] {
  const kept = rows.slice(0, rows.findLastIndex((row) => row.some((cell) => cell.text !== '')) + 1)
  const width = kept.reduce(
    (widest, row) => Math.max(widest, row.findLastIndex((cell) => cell.text !== '') + 1),
    0,
  )
  return kept.map((row) => Array.from({ length: width }, (_, column) => row[column] ?? EMPTY))
}

/** The first table in clipboard HTML, as a grid; undefined when there is none. */
export function gridFromHtml(html: string, doc: Document): PastedGrid | undefined {
  if (!/<table[\s>]/iu.test(html)) return undefined
  // A template's content is inert: nothing pasted loads or runs while it is read.
  const template = doc.createElement('template')
  template.innerHTML = html
  const table = template.content.querySelector('table')
  if (table === null) return undefined
  const grid: PastedCell[][] = []
  // Places a rowspan from an earlier row has already filled, by row and column.
  const covered = new Set<string>()
  let unmerged = false
  let rowIndex = 0
  for (const row of table.querySelectorAll('tr')) {
    if (isHidden(row)) continue
    const cells: PastedCell[] = []
    let column = 0
    for (const cell of row.querySelectorAll(':scope > td, :scope > th')) {
      while (covered.has(`${rowIndex}:${column}`)) {
        cells[column] = EMPTY
        column += 1
      }
      if (isHidden(cell)) continue
      const text = textOf(cell)
      const across = span(cell, 'colspan')
      const down = span(cell, 'rowspan')
      if ((across > 1 || down > 1) && text !== '') unmerged = true
      cells[column] = { element: cell, text }
      for (let extra = 1; extra < across; extra += 1) cells[column + extra] = EMPTY
      for (let below = 1; below < down; below += 1) {
        for (let extra = 0; extra < across; extra += 1)
          covered.add(`${rowIndex + below}:${column + extra}`)
      }
      column += across
    }
    while (covered.has(`${rowIndex}:${column}`)) {
      cells[column] = EMPTY
      column += 1
    }
    grid.push(cells)
    rowIndex += 1
  }
  const rows = trim(grid)
  return rows.length === 0 ? undefined : { rows, unmerged }
}

/**
 * Tab-separated text, as every spreadsheet puts on the clipboard: fields
 * quoted when they hold a tab, a line break or a quote, with quotes doubled.
 * Undefined unless it is a grid of at least two cells; a single line of words
 * is prose, which the ordinary paste handles.
 */
export function gridFromText(text: string): PastedGrid | undefined {
  if (!text.includes('\t')) return undefined
  let current: string[] = []
  const rows: string[][] = [current]
  let field = ''
  let quoted = false
  const source = text.replace(/\r\n?/gu, '\n').replace(/\n$/u, '')
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"' && field === '') quoted = true
    else if (char === '\t') {
      current.push(field)
      field = ''
    } else if (char === '\n') {
      current.push(field)
      field = ''
      current = []
      rows.push(current)
    } else field += char
  }
  current.push(field)
  const cells = trim(
    rows.map((row) =>
      row.map((value) => ({ element: null, text: value.replace(/\s+/gu, ' ').trim() })),
    ),
  )
  return cells.length === 0 ? undefined : { rows: cells, unmerged: false }
}
