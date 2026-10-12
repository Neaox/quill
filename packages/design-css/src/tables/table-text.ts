/**
 * A table as text a reader can paste somewhere else (ADR-040): CSV for a
 * spreadsheet, GFM Markdown for another document. Both take the table as it
 * is shown, sorted or not, and never its caption.
 */

export type ColumnAlign = 'left' | 'center' | 'right' | null

/** The text of a table, row by row, with what the reader needs to rebuild it. */
export interface TableText {
  readonly rows: readonly (readonly string[])[]
  /** Whether the first row is a header row. */
  readonly header: boolean
  readonly align: readonly ColumnAlign[]
}

const ALIGNMENTS: readonly (readonly [string, Exclude<ColumnAlign, null>])[] = [
  ['align-left', 'left'],
  ['align-center', 'center'],
  ['align-right', 'right'],
  ['align-numeric', 'right'],
]

function alignOf(cell: Element): ColumnAlign {
  return ALIGNMENTS.find(([name]) => cell.classList.contains(name))?.[1] ?? null
}

/** A cell's words on one line, as it reads. */
function cellText(cell: Element): string {
  return cell.textContent.replace(/\s+/gu, ' ').trim()
}

/** Reads a rendered table: its header, body and footer rows, in the order shown. */
export function readTable(table: HTMLTableElement): TableText {
  const rows = [...table.querySelectorAll(':scope > :is(thead, tbody, tfoot) > tr')]
  const header = table.querySelector(':scope > thead') !== null
  const widest = rows.reduce((most, row) => Math.max(most, row.children.length), 0)
  const sample = rows.at(-1)
  return {
    rows: rows.map((row) => [...row.children].map(cellText)),
    header,
    align: Array.from({ length: widest }, (_, index) => {
      const cell = sample?.children[index]
      return cell === undefined ? null : alignOf(cell)
    }),
  }
}

/** One CSV field: quoted when it holds a comma, a quote, a line break or edge spaces. */
function csvField(value: string): string {
  return /[",\r\n]|^\s|\s$/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/** RFC 4180 CSV, with CRLF line endings as spreadsheets expect. */
export function tableToCsv(text: TableText): string {
  return text.rows.map((row) => row.map(csvField).join(',')).join('\r\n')
}

const DELIMITERS: Readonly<Record<Exclude<ColumnAlign, null> | 'none', string>> = {
  none: '---',
  left: ':--',
  center: ':-:',
  right: '--:',
}

/** A GFM table, its alignment kept. A table with no header row gets an empty one. */
export function tableToMarkdown(text: TableText): string {
  const width = text.align.length
  const line = (cells: readonly string[]): string =>
    `| ${Array.from({ length: width }, (_, index) => (cells[index] ?? '').replaceAll('|', '\\|')).join(' | ')} |`
  const [first = [], ...rest] = text.rows
  const head = text.header ? first : []
  const body = text.header ? rest : text.rows
  const delimiter = `| ${text.align.map((align) => DELIMITERS[align ?? 'none']).join(' | ')} |`
  return [line(head), delimiter, ...body.map(line)].join('\n')
}
