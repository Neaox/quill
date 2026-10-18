import type {
  AlignType,
  Break,
  Emphasis,
  List,
  ListItem,
  Nodes,
  Root,
  Strong,
  Table,
  TableRow,
} from 'mdast'
import type { ContainerDirective, LeafDirective, TextDirective } from 'mdast-util-directive'
import { defaultHandlers } from 'mdast-util-to-markdown'
import type { Handle, Info, Join } from 'mdast-util-to-markdown'
import { visit } from 'unist-util-visit'

import type { ToMarkdownExtension } from './raw-mdast.ts'

/**
 * How a node was written, where mdast does not record it and a reader cannot
 * tell the difference (ADR-002, ADR-003 requirement 5).
 *
 * mdast keeps what a document means, not how it was typed, so writing a tree
 * back chooses one spelling for each construct: `*` for emphasis, a backslash
 * for a hard break, a blank line between every item of a loose list, `| - |`
 * for a table's delimiter row, quoted attribute values. A document opened in
 * the editor and saved unchanged was rewritten in that spelling, which is
 * noise in every Git diff and not what ADR-003 promises: soft wraps are the one
 * normalisation an author should see.
 *
 * Parsing records the spelling here; the editor carries it as an opaque
 * attribute; writing uses it for as long as it still describes the node — the
 * same attributes, the same columns, the same neighbours — and the canonical
 * spelling otherwise. Nothing here changes what a document means: every form
 * recorded is one the canonical form is equivalent to.
 */
export interface SourceForm {
  /** Emphasis or strong emphasis written with `_` rather than `*`. */
  readonly marker?: '_'
  /** A hard break written as trailing spaces rather than a backslash: the spaces. */
  readonly spaces?: string
  /**
   * How many blank lines were written between a block and the one before it,
   * where that is not the one the writer puts there: none, or several.
   */
  readonly blankLines?: number
  /**
   * An ordered list's item numbers as written, where they do not count up from
   * its start. Only the first number means anything to a reader (CommonMark 5.3).
   */
  readonly numbers?: readonly number[]
  /** A table's delimiter row as written. */
  readonly delimiterRow?: string
  /** A table row as written, and the content it was read as. */
  readonly row?: { readonly written: string; readonly content: string }
  /** A directive's attributes as written, and the attributes they read as. */
  readonly attributes?: { readonly written: string; readonly read: string }
  /**
   * A `link` that was written as the directive (`:link[…]{…}`) and not as a link with a comment, so
   * it is written back the way it was until an author changes it (`link-comment.ts`).
   */
  readonly directiveForm?: true
  /** A container directive with a blank line after its opening fence and before its closing one. */
  readonly padded?: true
  /**
   * The form of the `:::wide` or `:::full` wrapper a block was lifted out of
   * in the editor (ADR-027), on the first block it held.
   */
  readonly wrapper?: SourceForm
}

declare module 'mdast' {
  interface Data {
    /** How the node was written, where mdast does not say (`source-form.ts`). */
    sourceForm?: SourceForm | undefined
  }
}

type Directive = ContainerDirective | LeafDirective | TextDirective
type Node = Nodes | Directive

interface Span {
  readonly start: number
  readonly end: number
  readonly line: number
  readonly endLine: number
  readonly column: number
}

/** Where a node is in the source; undefined for a node the parser did not make. */
function spanOf(node: Node): Span | undefined {
  const { position } = node
  if (position?.start.offset === undefined || position.end.offset === undefined) return undefined
  return {
    start: position.start.offset,
    end: position.end.offset,
    line: position.start.line,
    endLine: position.end.line,
    column: position.start.column,
  }
}

function isDirectiveLabel(node: Node): boolean {
  return node.type === 'paragraph' && node.data?.directiveLabel === true
}

/** The offset just past a balanced `[…]` starting at `from`, or `from` when there is none. */
function pastLabel(source: string, from: number): number {
  if (source.charAt(from) !== '[') return from
  let depth = 0
  for (let index = from; index < source.length; index += 1) {
    const character = source.charAt(index)
    if (character === '\\') index += 1
    else if (character === '[') depth += 1
    else if (character === ']' && --depth === 0) return index + 1
  }
  return from
}

/** A `{…}` attribute block starting at `from`, quotes respected, or undefined. */
function attributeBlock(source: string, from: number): string | undefined {
  if (source.charAt(from) !== '{') return undefined
  let quote = ''
  for (let index = from + 1; index < source.length; index += 1) {
    const character = source.charAt(index)
    if (quote !== '') {
      if (character === quote) quote = ''
    } else if (character === '"' || character === "'") quote = character
    else if (character === '}') return source.slice(from, index + 1)
  }
  return undefined
}

function withForm(node: Node, form: SourceForm): void {
  node.data = { ...node.data, sourceForm: { ...node.data?.sourceForm, ...form } }
}

/** The attributes JSON a directive's attributes compare by. */
export function attributesRead(attributes: Directive['attributes']): string {
  return JSON.stringify(attributes ?? {})
}

/**
 * Records how each node was written, for the nodes whose spelling mdast does
 * not keep. Mutates the tree it is given, which is the parser's own fresh one.
 * `readAttributes` reads an attribute block back, so only a block that reads as
 * the node's own attributes is recorded.
 */
export function markSourceForm(
  tree: Root,
  source: string,
  readAttributes: (block: string) => string | undefined,
): Root {
  const lines = source.split('\n')

  function markDirective(node: Directive, span: Span): void {
    const [head] = node.children
    const label = head !== undefined && isDirectiveLabel(head) ? spanOf(head)?.end : undefined
    const nameEnd = span.start + source.slice(span.start).indexOf(node.name) + node.name.length
    const written = attributeBlock(source, label ?? pastLabel(source, nameEnd))
    if (written === undefined || readAttributes(written) !== attributesRead(node.attributes)) return
    withForm(node, { attributes: { written, read: attributesRead(node.attributes) } })
  }

  function markPadding(node: ContainerDirective, span: Span): void {
    const body = node.children.filter((child) => !isDirectiveLabel(child))
    const first = body.at(0)
    const last = body.at(-1)
    const opening = first === undefined ? undefined : spanOf(first)
    const closing = last === undefined ? undefined : spanOf(last)
    if (opening === undefined || closing === undefined) return
    if (opening.line > span.line + 1 && span.endLine > closing.endLine + 1) {
      withForm(node, { padded: true })
    }
  }

  /** The blank lines before each block of a flow container, where not one. */
  function markBlankLines(node: Node & { readonly children: readonly Node[] }): void {
    node.children.forEach((child, index) => {
      const previous = node.children[index - 1]
      if (previous === undefined || isDirectiveLabel(previous)) return
      const before = spanOf(previous)
      const after = spanOf(child)
      if (before === undefined || after === undefined) return
      const blankLines = after.line - before.endLine - 1
      if (blankLines !== 1) withForm(child, { blankLines })
    })
  }

  function markNumbers(node: List): void {
    if (node.ordered !== true) return
    // Each item's span starts at its number; the first number is the list's start.
    const numbers = node.children.map((item) =>
      Number.parseInt(source.slice(item.position?.start.offset), 10),
    )
    const [start = 0] = numbers
    if (numbers.some((number, index) => number !== start + index)) withForm(node, { numbers })
  }

  function markTable(node: Table, span: Span): void {
    const written = (line: number): string =>
      lines
        .slice(line - 1, line)
        .join('')
        .slice(span.column - 1)
    for (const row of node.children) {
      const rowSpan = spanOf(row)
      if (rowSpan !== undefined) {
        withForm(row, { row: { written: written(rowSpan.line), content: rowContent(row) } })
      }
    }
    const header = node.children[0]
    const headerSpan = header === undefined ? undefined : spanOf(header)
    if (headerSpan !== undefined) withForm(node, { delimiterRow: written(headerSpan.endLine + 1) })
  }

  visit(tree, (node) => {
    const span = spanOf(node)
    if (span === undefined) return
    switch (node.type) {
      case 'emphasis':
      case 'strong':
        if (source.charAt(span.start) === '_') withForm(node, { marker: '_' })
        return
      case 'break': {
        const spaces = /^ +(?=\n)/.exec(source.slice(span.start, span.end))?.[0]
        if (spaces !== undefined) withForm(node, { spaces })
        return
      }
      case 'list':
        markBlankLines(node)
        markNumbers(node)
        return
      case 'root':
      case 'blockquote':
      case 'listItem':
      case 'footnoteDefinition':
        markBlankLines(node)
        return
      case 'table':
        markTable(node, span)
        return
      case 'containerDirective':
        markBlankLines(node)
        markPadding(node, span)
        markDirective(node, span)
        return
      case 'leafDirective':
      case 'textDirective':
        markDirective(node, span)
        return
      default:
        return
    }
  })
  return tree
}

const WORD = /[\p{L}\p{N}]/u

/**
 * An emphasis or strong node, written with the marker it was read with. `_`
 * does nothing inside a word, so where a letter or digit now stands outside the
 * node — an edit put one there — the canonical `*` is used instead.
 */
function attention(original: Handle, option: 'emphasis' | 'strong'): Handle {
  const marked = (node: Emphasis | Strong, info: Info): boolean =>
    node.data?.sourceForm?.marker === '_' &&
    !WORD.test(info.before.slice(-1)) &&
    !WORD.test(info.after.charAt(0))
  const handle: Handle = (node: Emphasis | Strong, parent, state, info) => {
    if (!marked(node, info)) return original(node, parent, state, info)
    const { options } = state
    const previous = options[option]
    options[option] = '_'
    try {
      return original(node, parent, state, info)
    } finally {
      options[option] = previous
    }
  }
  // What the node opens with, which the writer asks before writing the text in
  // front of it.
  const peek: Handle = (node: Emphasis | Strong, _parent, state, info) =>
    marked(node, info) ? '_' : (state.options[option] ?? '*')
  return Object.assign(handle, { peek })
}

/** A hard break, written with the trailing spaces it was read with where it can be. */
function hardBreak(original: Handle): Handle {
  return (node: Break, parent, state, info) => {
    const written = original(node, parent, state, info)
    const spaces = node.data?.sourceForm?.spaces
    return written === '\\\n' && spaces !== undefined ? `${spaces}\n` : written
  }
}

/**
 * A list item, numbered as it was written while its list holds the items it
 * was read with. The library numbers an item from its list's start, so it is
 * handed a list that starts where this item's number puts it.
 */
function listItem(original: Handle): Handle {
  return (node: ListItem, parent, state, info) => {
    const numbers = parent?.type === 'list' ? parent.data?.sourceForm?.numbers : undefined
    if (parent?.type !== 'list' || numbers?.length !== parent.children.length) {
      return original(node, parent, state, info)
    }
    const index = parent.children.indexOf(node)
    const start = Number(numbers[index]) - index
    return original(node, { ...parent, start }, state, info)
  }
}

/** A delimiter row's cells: their alignment, or undefined when the row is not one. */
function delimiterAlignment(row: string): readonly AlignType[] | undefined {
  const cells = row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
  const align: AlignType[] = []
  for (const cell of cells) {
    const match = /^\s*(:?)-+(:?)\s*$/.exec(cell)
    if (match === null) return undefined
    const [, left, right] = match
    align.push(left === ':' ? (right === ':' ? 'center' : 'left') : right === ':' ? 'right' : null)
  }
  return align
}

/** What a table row says, compared as JSON: its cells' content, not where or how it was written. */
function rowContent(row: TableRow): string {
  return JSON.stringify(
    row.children.map((cell) => cell.children),
    (key, value: unknown) =>
      key === 'position' || key === 'data' || value === null ? undefined : value,
  )
}

/**
 * A table, written with the lines it was read from while they still describe
 * it. The delimiter row is kept while the table has as many columns, aligned
 * the same way; within such a table, each row is kept while its cells say what
 * they said. A row that changed is written in the canonical form, unpadded
 * (ADR-003 requirement 4), so an edit rewrites only its own line.
 */
function table(original: Handle): Handle {
  return (node: Table, parent, state, info) => {
    const written = original(node, parent, state, info)
    const delimiterRow = node.data?.sourceForm?.delimiterRow
    if (delimiterRow === undefined) return written
    const lines = written.split('\n')
    const line = (index: number): string => lines.slice(index, index + 1).join('')
    const align = delimiterAlignment(delimiterRow)
    const columns = delimiterAlignment(line(1))?.length
    const same = (node.align ?? []).every((value, index) => (value ?? null) === align?.[index])
    if (align?.length !== columns || !same) return written
    const rows = node.children.map((row, index) => {
      const form = row.data?.sourceForm?.row
      const canonical = line(index === 0 ? 0 : index + 1)
      return form !== undefined && form.content === rowContent(row) ? form.written : canonical
    })
    return [rows[0], delimiterRow, ...rows.slice(1)].join('\n')
  }
}

/**
 * A directive, with its attribute block as written while the attributes are
 * the ones it was read with, and a container's blank lines inside its fences.
 * The library writes the opening line and then, for a container, a line break:
 * the block goes at the end of the opening line.
 */
function directive(original: Handle): Handle {
  return (node: Directive, parent, state, info) => {
    const form = node.data?.sourceForm
    const kept =
      form?.attributes !== undefined && form.attributes.read === attributesRead(node.attributes)
        ? form.attributes.written
        : undefined
    const written = original(
      kept === undefined ? node : { ...node, attributes: {} },
      parent,
      state,
      info,
    )
    const openingEnd = node.type === 'containerDirective' ? written.indexOf('\n') : -1
    const withAttributes =
      kept === undefined
        ? written
        : openingEnd === -1
          ? `${written}${kept}`
          : `${written.slice(0, openingEnd)}${kept}${written.slice(openingEnd)}`
    if (form?.padded !== true) return withAttributes
    const open = withAttributes.indexOf('\n')
    const close = withAttributes.lastIndexOf('\n')
    if (open === close) return withAttributes
    return `${withAttributes.slice(0, open)}\n${withAttributes.slice(open, close)}\n${withAttributes.slice(close)}`
  }
}

/** Blocks that end on a line of their own, so whatever follows starts a block of its own. */
const SELF_CLOSING: ReadonlySet<string> = new Set([
  'code',
  'containerDirective',
  'heading',
  'leafDirective',
  'thematicBreak',
  'yaml',
])

/**
 * Blocks that start on a line of their own after a paragraph, a list or a
 * quote, rather than being read into it as a lazy continuation line: a heading,
 * a fence, a thematic break and a quote (CommonMark 5.1, 5.2). A thematic
 * break is not one after a paragraph, where `---` underlines a heading.
 */
function interrupts(left: Node, right: Node): boolean {
  switch (right.type) {
    case 'heading':
    case 'code':
      return true
    case 'blockquote':
      return left.type !== 'blockquote'
    case 'thematicBreak':
      return left.type !== 'paragraph'
    default:
      return false
  }
}

/**
 * Whether `right`, written on the line after `left` with no blank line between,
 * still reads as a block of its own. Only pairs that hold whatever their
 * content are allowed. After a paragraph, a table does too, its delimiter row
 * being on the next line; so does a list whose first item has words and which,
 * if ordered, starts at 1 (CommonMark 5.2, 5.3).
 */
function startsOwnBlock(left: Node, right: Node): boolean {
  if (SELF_CLOSING.has(left.type)) return true
  if (left.type !== 'paragraph' && left.type !== 'list' && left.type !== 'blockquote') return false
  if (interrupts(left, right)) return true
  if (left.type !== 'paragraph') return false
  if (right.type === 'table') return true
  if (right.type !== 'list') return false
  const lead = right.children.at(0)?.children.at(0)
  const worded = lead?.type === 'paragraph' && lead.children.length > 0
  return worded && (right.ordered !== true || right.start === 1 || right.start === null)
}

/**
 * The blank lines between two blocks, as they were written, wherever writing
 * them so cannot change what the document reads as.
 *
 * - None, where the right block still starts a block of its own (`startsOwnBlock`).
 *   Between list items, none only while the list still reads as loose: an item
 *   with blank lines of its own, or another boundary that keeps one.
 * - Several, anywhere a single one would go: a run of blank lines reads as one.
 */
const blankLinesJoin: Join = (left, right, parent) => {
  const blankLines = right.data?.sourceForm?.blankLines
  if (blankLines === undefined) return undefined
  if (parent.type === 'list') {
    if (parent.spread !== true) return undefined
    if (blankLines > 0) return blankLines
    const stillLoose = parent.children.some(
      (item, index) =>
        item.spread === true || (index > 0 && item.data?.sourceForm?.blankLines !== 0),
    )
    return stillLoose ? 0 : undefined
  }
  if (parent.type === 'listItem' && parent.spread !== true) return undefined
  if (blankLines > 0) return blankLines
  return startsOwnBlock(left, right) ? 0 : undefined
}

/** The handlers of the extensions registered before this one that it writes on top of. */
export interface WrappedHandlers {
  readonly listItem?: Handle | undefined
  readonly table?: Handle | undefined
  readonly containerDirective?: Handle | undefined
  readonly leafDirective?: Handle | undefined
  readonly textDirective?: Handle | undefined
}

/** The wrapped handlers, for those of `handlers` there are: an undefined one would replace its original. */
function wrappedHandlers(handlers: WrappedHandlers): Record<string, Handle> {
  const wrapped: Record<string, Handle> = {}
  if (handlers.table !== undefined) wrapped['table'] = table(handlers.table)
  for (const name of ['containerDirective', 'leafDirective', 'textDirective'] as const) {
    const original = handlers[name]
    if (original !== undefined) wrapped[name] = directive(original)
  }
  return wrapped
}

/** The `toMarkdown` extension that writes each node in its recorded form. */
export function sourceFormToMarkdown(handlers: WrappedHandlers): ToMarkdownExtension {
  return {
    handlers: {
      emphasis: attention(defaultHandlers.emphasis, 'emphasis'),
      strong: attention(defaultHandlers.strong, 'strong'),
      break: hardBreak(defaultHandlers.break),
      // GFM writes task list items with a handler of its own, which is the one wrapped.
      listItem: listItem(handlers.listItem ?? defaultHandlers.listItem),
      ...wrappedHandlers(handlers),
    },
    join: [blankLinesJoin],
  }
}
