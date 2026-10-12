import type { Blockquote, Html, Paragraph, PhrasingContent, Root, RootContent } from 'mdast'

import type { DirectiveAttributes } from '../directives/definition.ts'
import { splitFirstLine } from '../pipeline/first-line.ts'
import type { Details } from './details.ts'

/**
 * Reading GitHub's `<details>` and Obsidian's foldable callouts out of a
 * freshly parsed tree (ADR-048). Both are recognised in the tree, after
 * CommonMark has parsed it, so neither changes how any core syntax parses
 * (ADR-039): to every other parser they are still raw HTML and a blockquote.
 */

/** Reads a summary's text as inline Markdown: its one paragraph's content, or undefined if it is not one. */
export type ReadInline = (text: string) => PhrasingContent[] | undefined

/** The JSON a node's content compares by: what it says, not where it was or how it was spelled. */
export function contentOf(value: unknown): string {
  return JSON.stringify(value, (key, inner: unknown) =>
    key === 'position' || key === 'data' || inner === null ? undefined : inner,
  )
}

/** What an HTML opening reads as, compared to decide whether it can be written back as it was. */
export function htmlOpeningRead(open: boolean, summary: readonly PhrasingContent[]): string {
  return contentOf({ open, summary })
}

/** What an Obsidian marker reads as. */
export function calloutMarkerRead(attributes: DirectiveAttributes): string {
  return contentOf(attributes)
}

function summaryParagraph(children: PhrasingContent[]): Paragraph {
  return { type: 'paragraph', data: { directiveLabel: true }, children }
}

/* --- GitHub's HTML ------------------------------------------------------- */

/**
 * The tags an HTML node may hold for it to be part of a details: the opening
 * tag, bare or with a bare `open`; a summary of text; the closing tag. Lower
 * case and nothing else, so an attribute of any other kind, an event handler
 * above all, leaves the HTML exactly as raw as it was (ADR-011).
 */
const TAG = /<details( open)?>|<summary>([^<]*)<\/summary>|<\/details>/uy
const BETWEEN = /\s*/uy

type Token =
  | { readonly kind: 'open'; readonly open: boolean }
  | { readonly kind: 'summary'; readonly text: string }
  | { readonly kind: 'close' }

interface Located {
  readonly token: Token
  /** Where in the node's value the tag starts and ends. */
  readonly start: number
  readonly end: number
  readonly line: number
  readonly endLine: number
}

function lineAt(node: Html, offset: number): number {
  const first = node.position?.start.line ?? 0
  return first + (node.value.slice(0, offset).match(/\n/gu)?.length ?? 0)
}

/** The tags an HTML node is made of, or undefined if it holds anything else. */
function tagsOf(node: Html): Located[] | undefined {
  const tags: Located[] = []
  let at = 0
  const skip = (): void => {
    BETWEEN.lastIndex = at
    BETWEEN.exec(node.value)
    at = BETWEEN.lastIndex
  }
  skip()
  while (at < node.value.length) {
    TAG.lastIndex = at
    const match = TAG.exec(node.value)
    if (match === null) return undefined
    const [whole, open, summary] = match
    const token: Token =
      summary !== undefined
        ? { kind: 'summary', text: summary }
        : whole.startsWith('</')
          ? { kind: 'close' }
          : { kind: 'open', open: open !== undefined }
    const end = at + whole.length
    tags.push({ token, start: at, end, line: lineAt(node, at), endLine: lineAt(node, end) })
    at = end
    skip()
  }
  return tags.length === 0 ? undefined : tags
}

/** A details being read: opened, perhaps summarised, gathering its body until it is closed. */
interface Frame {
  readonly open: boolean
  readonly openLine: number
  readonly blankLinesBefore: number | undefined
  /** The opening as written so far, and the line it ends on. */
  opening: string
  openingEndLine: number
  summary: PhrasingContent[] | undefined
  readonly children: RootContent[]
  /** The lines the first thing in the frame started on and the last ended on. */
  firstLine: number | undefined
  lastLine: number
}

interface Item {
  readonly node: RootContent
  readonly line: number
  readonly endLine: number
}

/**
 * The siblings of one flow container with every complete details made one
 * node; undefined when its tags do not balance, or a summary is out of place,
 * in which case nothing at this level is read as details.
 */
function readHtmlSiblings(
  children: readonly RootContent[],
  readInline: ReadInline,
): RootContent[] | undefined {
  if (!children.some((child) => child.type === 'html' && tagsOf(child) !== undefined))
    return undefined
  const out: RootContent[] = []
  const stack: Frame[] = []
  let previousLine: number | undefined

  const place = (item: Item): void => {
    const top = stack.at(-1)
    if (top === undefined) out.push(item.node)
    else {
      top.children.push(item.node)
      top.firstLine ??= item.line
      top.lastLine = item.endLine
    }
    previousLine = item.endLine
  }

  for (const child of children) {
    const start = child.position?.start.line ?? 0
    const end = child.position?.end.line ?? start
    const tags = child.type === 'html' ? tagsOf(child) : undefined
    if (child.type !== 'html' || tags === undefined) {
      place({ node: child, line: start, endLine: end })
      continue
    }
    for (const [index, tag] of tags.entries()) {
      const { token } = tag
      const top = stack.at(-1)
      if (token.kind === 'open') {
        const recorded = child.data?.sourceForm?.blankLines
        stack.push({
          open: token.open,
          openLine: tag.line,
          blankLinesBefore:
            index === 0
              ? recorded
              : previousLine === undefined
                ? undefined
                : tag.line - previousLine - 1,
          opening: child.value.slice(tag.start, tag.end),
          openingEndLine: tag.endLine,
          summary: undefined,
          children: [],
          firstLine: undefined,
          lastLine: tag.endLine,
        })
        previousLine = tag.endLine
        continue
      }
      if (token.kind === 'summary') {
        if (top === undefined || top.summary !== undefined || top.children.length > 0)
          return undefined
        const inline = readInline(token.text.trim())
        if (inline === undefined) return undefined
        const gap =
          index === 0 ? `\n${'\n'.repeat(Math.max(tag.line - top.openingEndLine - 1, 0))}` : ''
        const between =
          index === 0 ? '' : child.value.slice(tags[index - 1]?.end ?? tag.start, tag.start)
        top.opening = `${top.opening}${gap}${between}${child.value.slice(tag.start, tag.end)}`
        top.openingEndLine = tag.endLine
        top.lastLine = tag.endLine
        top.summary = inline
        previousLine = tag.endLine
        continue
      }
      const closing = stack.pop()
      if (closing === undefined) return undefined
      previousLine = tag.endLine
      place({ node: finish(closing, tag), line: closing.openLine, endLine: tag.endLine })
    }
  }
  return stack.length === 0 ? out : undefined
}

/** The `details` node a frame was reading, closed by the tag `closing`. */
function finish(frame: Frame, closing: Located): Details {
  const summary = frame.summary ?? []
  const empty = frame.firstLine === undefined
  return {
    type: 'details',
    syntax: 'html',
    attributes: frame.open ? { open: '' } : {},
    source: {
      syntax: 'html',
      opening: frame.opening,
      read: htmlOpeningRead(frame.open, summary),
      // A details nested in the same HTML block starts on the very next line.
      afterOpening: (frame.firstLine ?? closing.line) - frame.openingEndLine - 1,
      beforeClosing: empty ? 0 : closing.line - frame.lastLine - 1,
    },
    // Lines only: the tags sit in HTML whose offsets are the container's, not the source's.
    position: {
      start: { line: frame.openLine, column: 1 },
      end: { line: closing.endLine, column: 1 },
    },
    children: [...(summary.length === 0 ? [] : [summaryParagraph(summary)]), ...frame.children],
    ...(frame.blankLinesBefore === undefined || frame.blankLinesBefore === 1
      ? {}
      : { data: { sourceForm: { blankLines: frame.blankLinesBefore } } }),
  }
}

/* --- Obsidian's foldable callouts --------------------------------------- */

/** `[!kind]-` or `[!kind]+` opening a blockquote's first line, and the spaces after it. */
const FOLDABLE_MARKER = /^\[!([A-Za-z][\w-]*)\]([+-])[^\S\n]*/u

/** A blockquote opening with a foldable marker, as a `details` node; undefined for any other quote. */
function fromCallout(node: Blockquote): Details | undefined {
  const [paragraph, ...blocks] = node.children
  if (paragraph?.type !== 'paragraph') return undefined
  const [opening, ...inline] = paragraph.children
  if (opening?.type !== 'text') return undefined
  const match = FOLDABLE_MARKER.exec(opening.value)
  if (match === null) return undefined
  const [whole, kind = '', sign] = match
  const remainder = opening.value.slice(whole.length)
  const split = splitFirstLine([
    ...(remainder === '' ? [] : [{ ...opening, value: remainder }]),
    ...inline,
  ])
  if (split === undefined) return undefined
  const title = trimEnd(split.line)
  const attributes: DirectiveAttributes = sign === '+' ? { type: kind, open: '' } : { type: kind }
  const joined = split.rest.length > 0
  const body: RootContent[] = joined
    ? [{ type: 'paragraph', children: split.rest }, ...blocks]
    : blocks
  return {
    type: 'details',
    syntax: 'callout',
    attributes,
    source: {
      syntax: 'callout',
      marker: whole.trimEnd(),
      read: calloutMarkerRead(attributes),
      joined,
    },
    children: [...(title.length === 0 ? [] : [summaryParagraph(title)]), ...body],
    ...(node.position === undefined ? {} : { position: node.position }),
    ...(node.data === undefined ? {} : { data: node.data }),
  }
}

/** Inline content without the spaces a line ends on, which no reader sees. */
function trimEnd(children: PhrasingContent[]): PhrasingContent[] {
  const last = children.at(-1)
  if (last?.type !== 'text') return children
  const value = last.value.trimEnd()
  return value === '' ? children.slice(0, -1) : [...children.slice(0, -1), { ...last, value }]
}

/* --- The walk ------------------------------------------------------------ */

/** Containers whose children are blocks, where a details can stand. */
const FLOW_PARENTS: ReadonlySet<string> = new Set([
  'root',
  'blockquote',
  'list',
  'listItem',
  'containerDirective',
  'footnoteDefinition',
  'details',
])

function withDetails(node: RootContent, readInline: ReadInline): RootContent {
  const callout = node.type === 'blockquote' ? fromCallout(node) : undefined
  const current = callout ?? node
  if (!FLOW_PARENTS.has(current.type) || !('children' in current)) return current
  const children: readonly RootContent[] = current.children
  return Object.assign({}, current, { children: readSiblings(children, readInline) })
}

function readSiblings(children: readonly RootContent[], readInline: ReadInline): RootContent[] {
  const read = children.map((child) => withDetails(child, readInline))
  return readHtmlSiblings(read, readInline) ?? read
}

/**
 * Finds every details written in GitHub's HTML or as an Obsidian foldable
 * callout, wherever it stands — at the top, in a list item, in a quote, in a
 * directive — and makes each one a `details` node. Every other node is left
 * as it was. `readInline` reads a summary's text, which is Markdown.
 */
export function readDetails(tree: Root, readInline: ReadInline): Root {
  return { ...tree, children: readSiblings(tree.children, readInline) }
}
