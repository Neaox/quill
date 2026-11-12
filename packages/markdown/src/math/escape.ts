import type { Heading, Paragraph, PhrasingContent, Root, RootContent, TableCell, Text } from 'mdast'

import { rawMdast } from '../pipeline/raw-mdast.ts'
import { rewriteTree } from '../tree.ts'
import { inlineSource } from './mdast.ts'
import { inlineMathSpans } from './rules.ts'
import type { InlineMathSpan } from './rules.ts'

/**
 * Writing a tree so that reading it back finds the same math (ADR-064).
 *
 * A dollar in text is a dollar, and is written as one: prices, prompts and
 * variables are not escaped. But two of them can be read as the ends of a
 * formula the author never wrote, and a formula that is written can be read as
 * something else when text sits against it. Each of these is decided here, over
 * a whole paragraph, because the pair can be on either side of emphasis or a
 * link:
 *
 * - **a dollar that would pair** with another is written `\$`. Which would is
 *   `rules.ts`'s answer, asked of the source the paragraph is about to be
 *   written as, again after each escape, because escaping one can let the next
 *   pair with something beyond it.
 * - **a dollar against a formula** (before its opening dollar, or after its
 *   closing one) is written `\$`, since the formula would no longer open, or
 *   close.
 * - **a digit after a formula** is written as a character reference, since a
 *   closing dollar before a digit is not one.
 * - **two formulas side by side** have a zero-width space between them, for the
 *   same reason as the dollar.
 * - **`$$` at the start of a line** of a paragraph is written `\$$`: it would
 *   read as a block, or as the start of one.
 *
 * Every one reads back as the text it was, so nothing here changes what a
 * document says; it changes the bytes only where they would otherwise change
 * the meaning.
 */

/** Stands for a node that is written but is not the text a dollar could pair across. */
const OBJECT = '\uFFFC'
const ZERO_WIDTH_SPACE = '&#x200B;'

/** The nodes whose phrasing content is one run of prose, as the reader sees it. */
type ProseRoot = Paragraph | Heading | TableCell

const isProseRoot = (node: RootContent): node is ProseRoot =>
  node.type === 'paragraph' || node.type === 'heading' || node.type === 'tableCell'

/** One character of a text node written as something else, by offset into its value. */
interface Edit {
  readonly at: number
  readonly raw: string
}

/** A prose root laid out as the one string of source it is written as. */
interface Layout {
  readonly source: string
  /** Where each text node starts in `source`. */
  readonly texts: ReadonlyMap<Text, number>
  /** Where each formula's opening and closing dollars are in `source`. */
  readonly formulas: readonly InlineMathSpan[]
}

function layoutOf(root: ProseRoot): Layout {
  let source = ''
  const texts = new Map<Text, number>()
  const formulas: InlineMathSpan[] = []

  const visit = (node: PhrasingContent): void => {
    switch (node.type) {
      case 'text': {
        texts.set(node, source.length)
        source += node.value
        return
      }
      case 'inlineMath': {
        const tex = inlineSource(node.value)
        if (tex === '') return
        formulas.push({ open: source.length, close: source.length + tex.length + 1 })
        source += `$${tex}$`
        return
      }
      case 'break': {
        source += '\n'
        return
      }
      default: {
        // Emphasis, a link and the like are written around their content, with characters of
        // their own (never a space, never a digit, never a dollar) at each end.
        source += OBJECT
        if ('children' in node) for (const child of node.children) visit(child)
        source += OBJECT
      }
    }
  }
  for (const child of root.children) visit(child)
  return { source, texts, formulas }
}

/** The offsets of the dollars of `source` that belong to a text node, not to a formula. */
function textDollars(layout: Layout): ReadonlySet<number> {
  const found = new Set<number>()
  for (const [node, start] of layout.texts) {
    for (
      let index = node.value.indexOf('$');
      index !== -1;
      index = node.value.indexOf('$', index + 1)
    ) {
      found.add(start + index)
    }
  }
  return found
}

/** A `$$` at the start of a line, which a paragraph would read as a block. */
function blockStarts(source: string, dollars: ReadonlySet<number>): readonly number[] {
  return [...dollars].filter(
    (at) =>
      source.charAt(at + 1) === '$' &&
      dollars.has(at + 1) &&
      /(?:^|\n) {0,3}$/u.test(source.slice(0, at)),
  )
}

/** `source` as it will be written, with a backslash before each dollar in `escaped`. */
function writtenWith(
  source: string,
  escaped: ReadonlySet<number>,
): { readonly text: string; readonly origin: readonly number[] } {
  let text = ''
  const origin: number[] = []
  for (let index = 0; index < source.length; index += 1) {
    if (escaped.has(index)) {
      text += '\\'
      origin.push(index)
    }
    text += source.charAt(index)
    origin.push(index)
  }
  return { text, origin }
}

/** The dollars of the text of `layout` that have to be escaped, and the digits that have to be references. */
function decide(
  layout: Layout,
  startsBlocks: boolean,
): { readonly dollars: ReadonlySet<number>; readonly digits: ReadonlySet<number> } {
  const own = textDollars(layout)
  const dollars = new Set<number>(startsBlocks ? blockStarts(layout.source, own) : [])
  const digits = new Set<number>()

  // A closing dollar before a digit is not one: the digit is written as a reference. A digit that
  // is not text (there is none: a formula is followed by what is not a digit, or by text) cannot be.
  let source = layout.source
  for (const { close } of layout.formulas) {
    if (/\d/u.test(source.charAt(close + 1))) {
      digits.add(close + 1)
      source = `${source.slice(0, close + 1)}&${source.slice(close + 2)}`
    }
  }

  for (;;) {
    const { text, origin } = writtenWith(source, dollars)
    /* v8 ignore start -- the origin has every offset of the text; the fallback satisfies the index type. */
    const spans = inlineMathSpans(text).map(({ open, close }) => ({
      open: origin[open] ?? open,
      close: origin[close] ?? close,
    }))
    /* v8 ignore stop */
    const next = new Set<number>()
    for (const { open, close } of spans) {
      for (const end of [open, close]) if (own.has(end) && !dollars.has(end)) next.add(end)
    }
    // A formula that is not among them was not read: a dollar of the text stands against it.
    for (const { open, close } of layout.formulas) {
      if (spans.some((span) => span.open === open && span.close === close)) continue
      for (const neighbour of [open - 1, close + 1]) {
        if (own.has(neighbour) && !dollars.has(neighbour)) next.add(neighbour)
      }
    }
    if (next.size === 0) return { dollars, digits }
    for (const at of next) dollars.add(at)
  }
}

/** A text node with the characters of `edits` written as the raw Markdown they name. */
function split(node: Text, edits: readonly Edit[]): readonly PhrasingContent[] {
  const parts: PhrasingContent[] = []
  let from = 0
  for (const { at, raw } of edits.toSorted((a, b) => a.at - b.at)) {
    if (at > from) parts.push({ ...node, value: node.value.slice(from, at) })
    parts.push(rawMdast(raw))
    from = at + 1
  }
  if (from < node.value.length) parts.push({ ...node, value: node.value.slice(from) })
  return parts
}

/**
 * `children` with `edits` applied to the text, and a zero-width space between two formulas that
 * would otherwise touch.
 */
function applied(
  children: readonly PhrasingContent[],
  edits: ReadonlyMap<Text, readonly Edit[]>,
): PhrasingContent[] {
  return children.flatMap((child, index): PhrasingContent[] => {
    const touches = child.type === 'inlineMath' && children[index - 1]?.type === 'inlineMath'
    const lead = touches ? [rawMdast(ZERO_WIDTH_SPACE)] : []
    if (child.type === 'text') {
      const own = edits.get(child)
      return [...lead, ...(own === undefined ? [child] : split(child, own))]
    }
    if ('children' in child)
      return [...lead, { ...child, children: applied(child.children, edits) }]
    return [...lead, child]
  })
}

function escapeRoot(root: ProseRoot): ProseRoot {
  const layout = layoutOf(root)
  if (!layout.source.includes('$')) return root
  const { dollars, digits } = decide(layout, root.type === 'paragraph')

  const edits = new Map<Text, Edit[]>()
  for (const [node, start] of layout.texts) {
    const own: Edit[] = []
    for (let index = 0; index < node.value.length; index += 1) {
      const at = start + index
      if (dollars.has(at)) own.push({ at: index, raw: '\\$' })
      else if (digits.has(at)) {
        own.push({ at: index, raw: `&#x${node.value.charCodeAt(index).toString(16)};` })
      }
    }
    if (own.length > 0) edits.set(node, own)
  }

  return { ...root, children: applied(root.children, edits) }
}

/** The tree, with the dollars that would be read as math written so that they are not. Pure. */
export function withDollarEscapes(tree: Root): Root {
  return rewriteTree(tree, (node) => (isProseRoot(node) ? [escapeRoot(node)] : undefined))
}
