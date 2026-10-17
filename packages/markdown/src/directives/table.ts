import type { ContainerDirective } from 'mdast-util-directive'
import type { Paragraph, Table } from 'mdast'

import type {
  Directive,
  DirectiveAttributes,
  DirectiveContent,
  DirectiveDefinition,
  DirectiveIssue,
} from './definition.ts'
import { bodyOf, issue } from './definition.ts'
import type { LayoutWidth } from './layout.ts'
import { isLayoutWidth } from './layout.ts'

/**
 * `:::table[Caption]{…}` (ADR-040): reading options for the one GFM table it
 * wraps.
 *
 * ```text
 * :::table[Latency budgets by region]{width=70% columns="2fr 3fr 1fr" headers=both footer=1 freeze=header,first-column}
 * | Region | Owner | Budget |
 * | ------ | ----- | -----: |
 * | eu     | Ops   |    120 |
 * | Total  |       |    120 |
 * :::
 * ```
 *
 * Every attribute is optional and the wrapper itself is: a bare table reads
 * exactly as one wrapped with no attributes. Outside Quill the wrapper
 * disappears and the table is a plain GFM table, its caption a line of text
 * above it and its footer its last rows (ADR-002). An attribute this
 * definition does not know, or whose value it cannot read, is kept in `other`
 * and written back unchanged, so a document written for a newer Quill loses
 * nothing here (AGENTS.md rule 7).
 *
 * Shaped to move behind `MarkdownExtension` (ADR-039): one definition holds
 * the syntax, the model, the checks and the way back to Markdown, and the
 * sanitiser grant is built from the constants below.
 */

/** A table's width: one of the three tracks, or a share of the full one. */
export type TableWidth = LayoutWidth | { readonly percent: number }

/** The parts of a table that can be frozen, in the order they are written. */
export const TABLE_FROZEN_PARTS = ['header', 'first-column', 'footer'] as const

export type TableFrozenPart = (typeof TABLE_FROZEN_PARTS)[number]

/**
 * What stays in view while the table scrolls. `auto` is the default: the
 * header and footer rows when the table is taller than the viewport, and the
 * first column on a narrow table. A list freezes exactly those parts; an empty
 * list (`freeze=none`) freezes nothing.
 */
export type TableFreeze = 'auto' | readonly TableFrozenPart[]

/**
 * Every `data-freeze` value the renderer can emit: `none`, or the frozen parts
 * in their fixed order, space-separated so CSS can match one with `~=`.
 */
export const TABLE_FREEZE_VALUES: readonly string[] = [
  'none',
  ...Array.from({ length: 2 ** TABLE_FROZEN_PARTS.length - 1 }, (_, mask) =>
    TABLE_FROZEN_PARTS.filter((_part, index) => ((mask + 1) & (1 << index)) !== 0).join(' '),
  ),
]

/**
 * Which cells head the table: the header row's (`column`, the default), the
 * first cell of every row's (`row`, where the GFM header row is read as an
 * ordinary row), or both.
 */
export const TABLE_HEADERS = ['column', 'row', 'both'] as const

export type TableHeaders = (typeof TABLE_HEADERS)[number]

export const TABLE_RESPONSIVE_MODES = ['scroll', 'stack'] as const

export type TableResponsiveMode = (typeof TABLE_RESPONSIVE_MODES)[number]

export const TABLE_CAPTION_SIDES = ['top', 'bottom'] as const

export type TableCaptionSide = (typeof TABLE_CAPTION_SIDES)[number]

/**
 * A percentage width is drawn to the nearest of these steps, so the stylesheet
 * can hold one rule per step: the page's CSP admits no `style` attribute, and
 * there is no portable way to read a free number out of an attribute in CSS.
 */
export const TABLE_PERCENT_STEP = 5

/** Every percentage the renderer can emit, as the attribute values the sanitiser admits. */
export const TABLE_PERCENTS: readonly string[] = Array.from(
  { length: 100 / TABLE_PERCENT_STEP },
  (_, index) => String((index + 1) * TABLE_PERCENT_STEP),
)

export interface TableOptions {
  readonly width: TableWidth | undefined
  /** Proportions, one per column; never pixels. */
  readonly columns: readonly number[] | undefined
  readonly headers: TableHeaders
  /** How many of the last rows are the footer: totals, never sorted into the data. */
  readonly footer: number
  readonly freeze: TableFreeze
  readonly responsive: TableResponsiveMode
  /** Whether a reader may sort the rows. The document is never reordered. */
  readonly sortable: boolean
  readonly captionSide: TableCaptionSide
}

export const DEFAULT_TABLE_OPTIONS: TableOptions = {
  width: undefined,
  columns: undefined,
  headers: 'column',
  footer: 0,
  freeze: 'auto',
  responsive: 'scroll',
  sortable: true,
  captionSide: 'top',
}

export interface TableBlock extends TableOptions {
  /** The `[label]`, which is the table's `<caption>` and accessible name. */
  readonly caption: Paragraph | undefined
  /** Attributes this definition does not understand, as written. */
  readonly other: DirectiveAttributes
  readonly children: DirectiveContent
}

export interface ReadTableOptions {
  readonly options: TableOptions
  readonly other: DirectiveAttributes
  readonly issues: readonly DirectiveIssue[]
}

const PERCENT = /^(\d{1,3})%$/
const PROPORTION = /^(\d+(?:\.\d+)?)(?:fr)?$/
const COUNT = /^[1-9]\d{0,2}$/

/** The attribute names this definition reads, in the order it writes them. */
const KNOWN = [
  'width',
  'columns',
  'headers',
  'footer',
  'freeze',
  'responsive',
  'sort',
  'caption',
] as const

type KnownName = (typeof KNOWN)[number]

function oneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value)
}

/** A value read, or the message saying why it could not be. */
type Reading<T> = { readonly value: T } | { readonly problem: string }

function readWidth(raw: string): Reading<TableWidth> {
  if (isLayoutWidth(raw)) return { value: raw }
  const percent = Number(PERCENT.exec(raw)?.[1])
  if (percent >= 1 && percent <= 100) return { value: { percent } }
  return {
    problem: `Unknown table width "${raw}"; use content, wide, full or a percentage such as 70%.`,
  }
}

function readColumns(raw: string): Reading<readonly number[]> {
  const proportions = raw
    .split(/\s+/)
    .filter((each) => each.length > 0)
    .map((each) => Number(PROPORTION.exec(each)?.[1]))
  if (proportions.length > 0 && proportions.every((each) => each > 0)) {
    return { value: proportions }
  }
  return {
    problem: `Column widths are proportions such as "2fr 3fr 1fr", never pixels; "${raw}" is ignored.`,
  }
}

function readFreeze(raw: string): Reading<TableFreeze> {
  if (raw === 'none') return { value: [] }
  const parts = raw.split(',').map((each) => each.trim())
  const known = parts.filter((part) => oneOf(TABLE_FROZEN_PARTS, part))
  if (known.length === parts.length && new Set(known).size === known.length) {
    return { value: known }
  }
  return {
    problem: `Unknown freeze "${raw}"; use header, first-column or footer, several separated by commas, or none.`,
  }
}

/** A value from a fixed list, or a problem naming the list. */
function readChoice<T extends string>(name: string, values: readonly T[]) {
  return (raw: string): Reading<T> =>
    oneOf(values, raw)
      ? { value: raw }
      : { problem: `Unknown ${name} "${raw}"; use ${values.join(' or ')}.` }
}

function readFooter(raw: string): Reading<number> {
  if (COUNT.test(raw)) return { value: Number(raw) }
  return { problem: `A footer is a number of rows, such as footer=1; "${raw}" is not one.` }
}

const readSort = readChoice('sort', ['on', 'off'] as const)

/**
 * The options in a table directive's attributes, the attributes it could not
 * read, and why. One pass, shared by `parse` and `validate`, so the two can
 * never disagree about what a value means.
 */
export function readTableOptions(
  attributes: DirectiveAttributes | null | undefined,
): ReadTableOptions {
  const other: Record<string, string | null | undefined> = {}
  const issues: DirectiveIssue[] = []
  let options: TableOptions = DEFAULT_TABLE_OPTIONS
  const entries = Object.entries(attributes ?? {})

  const read = <T>(
    name: KnownName,
    reader: (raw: string) => Reading<T>,
    apply: (value: T) => TableOptions,
  ): void => {
    const entry = entries.find(([key]) => key === name)
    if (entry === undefined) return
    const reading = reader(entry[1] ?? '')
    if ('value' in reading) {
      options = apply(reading.value)
      return
    }
    issues.push(issue(name, reading.problem, 'warning'))
  }

  read('width', readWidth, (width) => ({ ...options, width }))
  read('columns', readColumns, (columns) => ({ ...options, columns }))
  read('headers', readChoice('headers', TABLE_HEADERS), (headers) => ({ ...options, headers }))
  read('footer', readFooter, (footer) => ({ ...options, footer }))
  read('freeze', readFreeze, (freeze) => ({ ...options, freeze }))
  read('responsive', readChoice('responsive mode', TABLE_RESPONSIVE_MODES), (responsive) => ({
    ...options,
    responsive,
  }))
  read('sort', readSort, (sort) => ({ ...options, sortable: sort === 'on' }))
  read('caption', readChoice('caption side', TABLE_CAPTION_SIDES), (captionSide) => ({
    ...options,
    captionSide,
  }))

  const unread = new Set(issues.map((each) => each.path))
  for (const [name, value] of entries) {
    if (!oneOf(KNOWN, name) || unread.has(name)) other[name] = value
  }
  return { options, other, issues }
}

/** The one table a wrapper holds, or undefined when its body is anything else. */
export function tableOf(node: ContainerDirective): Table | undefined {
  const body = bodyOf(node)
  const [only] = body
  return body.length === 1 && only?.type === 'table' ? only : undefined
}

/** The `[label]` paragraph, which captions the table. */
function captionOf(node: ContainerDirective): Paragraph | undefined {
  const [first] = node.children
  return first?.type === 'paragraph' && first.data?.directiveLabel === true ? first : undefined
}

function columnCount(table: Table): number {
  return Math.max(...table.children.map((row) => row.children.length))
}

/** The rows below the header row; with `headers=row` the header row is one of them. */
export function bodyRowCount(table: Table, headers: TableHeaders): number {
  return table.children.length - (headers === 'row' ? 0 : 1)
}

function writeWidth(width: TableWidth): string {
  return typeof width === 'string' ? width : `${width.percent}%`
}

/** The attributes that say what `options` says, defaults left unwritten. */
function writeOptions(options: TableOptions): Record<string, string> {
  const written: Record<string, string> = {}
  if (options.width !== undefined) written['width'] = writeWidth(options.width)
  if (options.columns !== undefined) {
    written['columns'] = options.columns.map((each) => `${each}fr`).join(' ')
  }
  if (options.headers !== DEFAULT_TABLE_OPTIONS.headers) written['headers'] = options.headers
  if (options.footer > 0) written['footer'] = String(options.footer)
  if (options.freeze !== 'auto') {
    written['freeze'] = options.freeze.length === 0 ? 'none' : options.freeze.join(',')
  }
  if (options.responsive !== DEFAULT_TABLE_OPTIONS.responsive) {
    written['responsive'] = options.responsive
  }
  if (!options.sortable) written['sort'] = 'off'
  if (options.captionSide !== DEFAULT_TABLE_OPTIONS.captionSide) {
    written['caption'] = options.captionSide
  }
  return written
}

/** The checks that need the table itself: one width per column, a footer it can hold. */
function tableIssues(table: Table, options: TableOptions): DirectiveIssue[] {
  const found: DirectiveIssue[] = []
  const columns = columnCount(table)
  if (options.columns !== undefined && options.columns.length !== columns) {
    found.push(
      issue(
        'columns',
        `${options.columns.length} column widths for a ${columns}-column table; they are ignored.`,
        'warning',
      ),
    )
  }
  const rows = bodyRowCount(table, options.headers)
  if (options.footer > rows) {
    found.push(
      issue(
        'footer',
        `A footer of ${options.footer} rows in a table of ${rows}; every row is the footer.`,
        'warning',
      ),
    )
  }
  return found
}

export const tableDirective: DirectiveDefinition<TableBlock, ContainerDirective> = {
  names: ['table'],
  kinds: ['container'],

  parse(node: ContainerDirective): TableBlock {
    const { options, other } = readTableOptions(node.attributes)
    return { ...options, caption: captionOf(node), other, children: bodyOf(node) }
  },

  validate(node: Directive): readonly DirectiveIssue[] {
    if (node.type !== 'containerDirective') return []
    const { options, issues } = readTableOptions(node.attributes)
    const table = tableOf(node)
    if (table === undefined) {
      return [
        issue('', 'A table wrapper holds exactly one table; it is shown as written.', 'warning'),
        ...issues,
      ]
    }
    return [...issues, ...tableIssues(table, options)]
  },

  serialize(model: TableBlock): ContainerDirective {
    const known = writeOptions(model)
    const rest = Object.entries(model.other).filter(([name]) => !Object.hasOwn(known, name))
    return {
      type: 'containerDirective',
      name: 'table',
      attributes: { ...known, ...Object.fromEntries(rest) },
      children: model.caption === undefined ? model.children : [model.caption, ...model.children],
    }
  },
}

/**
 * Each column's share of the table, as the `width` of its `<col>`: the
 * proportions as percentages, to two decimal places.
 */
export function columnPercentages(proportions: readonly number[]): readonly string[] {
  const total = proportions.reduce((sum, each) => sum + each, 0)
  return proportions.map((each) => `${Math.round((each / total) * 10_000) / 100}%`)
}

/** A percentage width as the stylesheet draws it: the nearest step, never none. */
export function renderedPercent(percent: number): number {
  return Math.max(TABLE_PERCENT_STEP, Math.round(percent / TABLE_PERCENT_STEP) * TABLE_PERCENT_STEP)
}
