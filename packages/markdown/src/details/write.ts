import type { Blockquote, Paragraph, PhrasingContent, RootContent, Text } from 'mdast'
import type { ContainerDirective } from 'mdast-util-directive'
import type { Handle, Join } from 'mdast-util-to-markdown'

import { flag } from '../directives/definition.ts'
import { rawMdast } from '../pipeline/raw-mdast.ts'
import type { ToMarkdownExtension } from '../pipeline/raw-mdast.ts'
import type { Details } from './details.ts'
import { DETAILS, isDetails } from './details.ts'
import { calloutMarkerRead, htmlOpeningRead } from './read.ts'

/**
 * Writing a details back in the syntax it was read in (ADR-048): GitHub's
 * HTML with its opening as typed, an Obsidian callout with its marker as
 * typed, and anything else as Quill's own `:::details` directive.
 *
 * A source form is kept only while it can still say everything the details
 * says. GitHub's HTML has room for `open` and a one-line summary with no
 * markup in it, and Obsidian's marker for a kind, `open`, and a one-line
 * title. A details given a name, a kind, or a summary that does not fit is
 * written as the directive, which can hold all of them, rather than in a
 * form that would read back as something else.
 */

/** The attributes each source form can carry. */
const CARRIES: Readonly<Record<Details['syntax'], ReadonlySet<string>>> = {
  html: new Set(['open']),
  callout: new Set(['type', 'open']),
}

/** A callout kind as Obsidian writes it in a marker. */
const MARKER_KIND = /^[A-Za-z][\w-]*$/u

/**
 * Whether inline content is written on one line, and — for the HTML form,
 * where the summary sits between tags — without a `<` that would end it.
 * Words, code and emphasis; anything else, a link included, is left to the
 * directive, which can hold it.
 */
function fitsOneLine(children: readonly PhrasingContent[], html: boolean): boolean {
  return children.every((child) => {
    if (child.type === 'text' || child.type === 'inlineCode') {
      return !child.value.includes('\n') && !(html && child.value.includes('<'))
    }
    if (child.type === 'emphasis' || child.type === 'strong') {
      return fitsOneLine(child.children, html)
    }
    return false
  })
}

function isSummary(node: RootContent | undefined): node is Paragraph {
  return node?.type === 'paragraph' && node.data?.directiveLabel === true
}

function summaryOf(node: Details): Paragraph | undefined {
  const [first] = node.children
  return isSummary(first) ? first : undefined
}

function bodyOf(node: Details): Details['children'] {
  return node.children.filter((child) => !isSummary(child))
}

/** How a details is written in its source form: GitHub's HTML, or Obsidian's marker and its kind. */
type WrittenForm =
  | { readonly syntax: 'html' }
  | { readonly syntax: 'callout'; readonly type: string }

/** The source form a details can still be written in, or undefined when it has outgrown it. */
export function writtenForm(node: Details): WrittenForm | undefined {
  const names = Object.keys(node.attributes)
  if (!names.every((name) => CARRIES[node.syntax].has(name))) return undefined
  if (!fitsOneLine(summaryOf(node)?.children ?? [], node.syntax === 'html')) return undefined
  if (node.syntax === 'html') return { syntax: 'html' }
  const type = node.attributes['type']
  return typeof type === 'string' && MARKER_KIND.test(type)
    ? { syntax: 'callout', type }
    : undefined
}

/** The same details as Quill's own directive, which can say everything any form can. */
export function detailsDirectiveOf(node: Details): ContainerDirective {
  return {
    type: 'containerDirective',
    name: DETAILS,
    attributes: node.attributes,
    children: node.children,
    ...(node.data === undefined ? {} : { data: node.data }),
  }
}

type State = Parameters<Handle>[2]
type Info = Parameters<Handle>[3]

function summaryText(summary: Paragraph, state: State, info: Info): string {
  const exit = state.enter('paragraph')
  const inner = state.enter('phrasing')
  const value = state.containerPhrasing(summary, { ...info, before: '>', after: '<' })
  inner()
  exit()
  return value
}

function writeHtml(node: Details, state: State, info: Info): string {
  const open = flag(node, 'open')
  const summary = summaryOf(node)
  const source = node.source?.syntax === 'html' ? node.source : undefined
  const opening =
    source !== undefined && source.read === htmlOpeningRead(open, summary?.children ?? [])
      ? source.opening
      : `<details${open ? ' open' : ''}>${
          summary === undefined ? '' : `\n<summary>${summaryText(summary, state, info)}</summary>`
        }`
  const body = bodyOf(node)
  const [first] = body
  if (first === undefined) {
    return `${opening}${'\n'.repeat(1 + (source?.afterOpening ?? 1))}</details>`
  }
  // Only another details' own tag may share the opening's HTML block; Markdown
  // written straight under it would be read as part of the HTML.
  const nested = isDetails(first) && writtenForm(first)?.syntax === 'html'
  const afterOpening = Math.max(source?.afterOpening ?? 1, nested ? 0 : 1)
  const flow = state.containerFlow({ ...node, children: body }, info)
  return `${opening}${'\n'.repeat(1 + afterOpening)}${flow}${'\n'.repeat(1 + (source?.beforeClosing ?? 1))}</details>`
}

/** The end of the title's line, where a body that ran on from it starts. */
const LINE_BREAK: Text = { type: 'text', value: '\n' }

function writeCallout(
  node: Details,
  type: string,
  parent: Parameters<Handle>[1],
  state: State,
  info: Info,
): string {
  const source = node.source?.syntax === 'callout' ? node.source : undefined
  const marker =
    source !== undefined && source.read === calloutMarkerRead(node.attributes)
      ? source.marker
      : `[!${type}]${flag(node, 'open') ? '+' : '-'}`
  const title = summaryOf(node)?.children ?? []
  const body = bodyOf(node)
  const [lead, ...rest] = body
  // A new callout's body starts on the line under its title, as Obsidian writes it.
  const joined = (source?.joined ?? true) && lead?.type === 'paragraph'
  const head: Paragraph = {
    type: 'paragraph',
    children: [
      rawMdast(title.length === 0 ? marker : `${marker} `),
      ...title,
      ...(joined ? [LINE_BREAK, ...lead.children] : []),
    ],
  }
  const quote: Blockquote = {
    type: 'blockquote',
    children: [head, ...(joined ? rest : body)],
  }
  return state.handle(quote, parent, state, info)
}

const writeDetails: Handle = (node: Details, parent, state, info) => {
  const form = writtenForm(node)
  if (form === undefined) return state.handle(detailsDirectiveOf(node), parent, state, info)
  return form.syntax === 'html'
    ? writeHtml(node, state, info)
    : writeCallout(node, form.type, parent, state, info)
}

/**
 * A details written straight under the block before it, with no blank line,
 * is written that way again where it still reads as its own block: an HTML
 * details always does, because its tag interrupts any paragraph, and a
 * callout does after anything but another quote, which it would join.
 */
const tightDetails: Join = (left, right) => {
  if (!isDetails(right) || right.data?.sourceForm?.blankLines !== 0) return undefined
  const form = writtenForm(right)
  if (form === undefined) return undefined
  if (form.syntax === 'html') return 0
  return left.type === 'blockquote' || (isDetails(left) && left.syntax === 'callout')
    ? undefined
    : 0
}

export const detailsToMarkdown: ToMarkdownExtension = {
  handlers: { details: writeDetails },
  join: [tightDetails],
}
