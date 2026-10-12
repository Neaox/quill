import { toString } from 'mdast-util-to-string'
import type { TableRow } from 'mdast'

/**
 * A cell that reads as one number: an optional sign and currency, digits with
 * optional thousands separators and decimals, and an optional percentage or
 * short unit (`120 ms`, `3 GB`). Versions (`1.2.3`), dates and identifiers
 * (`eu-west-1`) are not numbers.
 */
const NUMBER = /^[-+−]?[$€£¥]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s?(?:%|[A-Za-zµ]{1,3}))?$/u

/** A cell that says "nothing here": empty, or a dash standing in for a value. */
const BLANK = /^[-–—]?$/u

/** The longest column name a stacked cell repeats as its label. */
export const CELL_LABEL_LIMIT = 80

/** A token a reader would not want broken across lines: an identifier, a date, a version. */
const TOKEN = /^\S{1,32}$/u

/** Where a browser would break a token: after a hyphen, a dash or a slash. */
const BREAKS = /[-‐–—/]/u

/** The average length from which a column reads as running text. */
const LONG_TEXT = 40

/**
 * What a column holds, which decides how it is set:
 *
 * - `numeric`: every body cell that holds anything is a number. Set flush
 *   right in tabular figures, so the digits line up, unless its author
 *   aligned it.
 * - `token`: every one is a single short token, and some would break at a
 *   hyphen or a slash (`eu-west-1`, `2026-01-01`). Kept on one line, because
 *   a date broken at its hyphen is unreadable. A column of plain words cannot
 *   break anyway, and is left alone.
 * - `long`: its cells average a sentence. Given room to read before the
 *   table scrolls, rather than squeezed to a word a line.
 * - `text`: anything else, laid out by the browser.
 */
export type ColumnShape = 'numeric' | 'token' | 'long' | 'text'

export function columnShape(rows: readonly TableRow[], column: number): ColumnShape {
  return shapeOfCells(
    rows
      .map((row) => row.children[column])
      .map((cell) => (cell === undefined ? '' : toString(cell).trim())),
  )
}

/** The shape of a column from the text of its body cells, wherever they are read from. */
export function shapeOfCells(texts: readonly string[]): ColumnShape {
  const values = texts.map((text) => text.trim()).filter((value) => !BLANK.test(value))
  if (values.length === 0) return 'text'
  if (values.every((value) => NUMBER.test(value))) return 'numeric'
  if (values.every((value) => TOKEN.test(value)) && values.some((value) => BREAKS.test(value))) {
    return 'token'
  }
  const average = values.reduce((sum, value) => sum + value.length, 0) / values.length
  return average >= LONG_TEXT ? 'long' : 'text'
}

/**
 * Each column's name as a stacked cell repeats it (`data-label`): the header
 * cell's text, cut to `CELL_LABEL_LIMIT` characters so a long heading cannot
 * bloat every row.
 */
export function columnLabels(head: TableRow | undefined): readonly string[] {
  return (head?.children ?? []).map((cell) =>
    [...toString(cell).trim()].slice(0, CELL_LABEL_LIMIT).join(''),
  )
}
