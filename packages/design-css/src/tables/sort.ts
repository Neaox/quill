/**
 * Sorting a table's rows for a reader (ADR-040): pure functions over cell
 * text, so the order is decided without touching the DOM and can be tested
 * without one.
 *
 * A column sorts as numbers when every cell that holds anything reads as a
 * number, as dates when every one reads as a date, and otherwise as text in
 * the reader's language with digits compared as numbers, so "Item 9" comes
 * before "Item 10". Empty cells always go last, whichever the direction, so
 * the rows that say something stay at the top.
 */

export type SortDirection = 'ascending' | 'descending'

/** A column's next state when its header is pressed: ascending, descending, then as written. */
export function nextDirection(current: SortDirection | undefined): SortDirection | undefined {
  if (current === undefined) return 'ascending'
  return current === 'ascending' ? 'descending' : undefined
}

/** The same shape of number the renderer right-aligns (`@quill/markdown`, `table-columns.ts`). */
const NUMBER = /^[-+−]?[$€£¥]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s?(?:%|[A-Za-zµ]{1,3}))?$/u

/** A cell that says "nothing here". */
const BLANK = /^[-–—]?$/u

const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const

/** `11 October 2026`, `11 Oct 2026`, `October 11, 2026`, `Oct 11 2026`. */
const DAY_MONTH_YEAR = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/
const MONTH_DAY_YEAR = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/

export function isBlank(text: string): boolean {
  return BLANK.test(text)
}

/** The number a cell reads as, or undefined. */
export function readNumber(text: string): number | undefined {
  if (!NUMBER.test(text)) return undefined
  const digits = text
    .replace('−', '-')
    .replace(/[$€£¥,\s%]/gu, '')
    .replace(/[A-Za-zµ]+$/u, '')
  return Number(digits)
}

function monthIndex(name: string): number {
  return MONTHS.findIndex((month) => name.toLowerCase().startsWith(month))
}

function utc(year: string, month: number, day: string): number | undefined {
  if (month < 0) return undefined
  return Date.UTC(Number(year), month, Number(day))
}

/** The instant a cell reads as, in milliseconds, or undefined. */
export function readDate(text: string): number | undefined {
  if (ISO_DATE.test(text)) return Date.parse(text.length === 10 ? `${text}T00:00:00Z` : text)
  const dayFirst = DAY_MONTH_YEAR.exec(text)
  if (dayFirst !== null) {
    const [, day = '', month = '', year = ''] = dayFirst
    return utc(year, monthIndex(month), day)
  }
  const monthFirst = MONTH_DAY_YEAR.exec(text)
  if (monthFirst === null) return undefined
  const [, month = '', day = '', year = ''] = monthFirst
  return utc(year, monthIndex(month), day)
}

export type ColumnKind = 'number' | 'date' | 'text'

/** How a column's cells compare: the narrowest kind every non-empty cell reads as. */
export function columnKind(texts: readonly string[]): ColumnKind {
  const values = texts.filter((text) => !isBlank(text))
  if (values.length === 0) return 'text'
  if (values.every((text) => readNumber(text) !== undefined)) return 'number'
  if (values.every((text) => readDate(text) !== undefined)) return 'date'
  return 'text'
}

/** One cell's sort key; `undefined` for an empty cell. */
type Key = number | string | undefined

function keyOf(text: string, kind: ColumnKind): Key {
  if (isBlank(text)) return undefined
  if (kind === 'number') return readNumber(text)
  if (kind === 'date') return readDate(text)
  return text
}

/** Something to sort, and the text of its cell in the column sorted by. */
export interface SortEntry<T> {
  readonly item: T
  readonly text: string
}

/**
 * The items in the order that sorts their column. Stable, so rows that tie
 * keep the order they were written in.
 */
export function sortRows<T>(
  entries: readonly SortEntry<T>[],
  direction: SortDirection,
  collator: Intl.Collator,
): T[] {
  const kind = columnKind(entries.map(({ text }) => text))
  const sign = direction === 'ascending' ? 1 : -1
  const compare = (left: Key, right: Key): number => {
    if (typeof left === 'number' && typeof right === 'number') return left - right
    return collator.compare(String(left), String(right))
  }
  return entries
    .map(({ item, text }) => ({ item, key: keyOf(text, kind) }))
    .toSorted((left, right) => {
      if (left.key === undefined || right.key === undefined) {
        return Number(left.key === undefined) - Number(right.key === undefined)
      }
      return sign * compare(left.key, right.key)
    })
    .map(({ item }) => item)
}
