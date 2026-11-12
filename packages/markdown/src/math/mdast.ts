import type { Literal } from 'mdast'
import type { CompileContext, Extension, Token } from 'mdast-util-from-markdown'

import type { ToMarkdownExtension } from '../pipeline/raw-mdast.ts'

/**
 * Math in the Markdown tree (ADR-064): a formula in a sentence, and a block of
 * its own. Both keep the TeX exactly as it was written, in `value`; what it is
 * drawn as is the renderer's business, so the tree, a draft and a diff all hold
 * the author's own source and nothing derived from it.
 *
 * The names are mdast-util-math's, so a tree from one is a tree for the other.
 */
export interface InlineMath extends Literal {
  type: 'inlineMath'
}

export interface BlockMath extends Literal {
  type: 'math'
}

declare module 'mdast' {
  interface RootContentMap {
    inlineMath: InlineMath
    math: BlockMath
  }
  interface BlockContentMap {
    math: BlockMath
  }
  interface PhrasingContentMap {
    inlineMath: InlineMath
  }
}

/** A line ending at the very start or end of a block's text: the fences' own, not the formula's. */
const EDGE_LINE_ENDINGS = /^(?:\r?\n|\r)|(?:\r?\n|\r)$/gu

/** Starts a literal node that collects its characters in a buffer, which `close` empties into it. */
function open(context: CompileContext, node: InlineMath | BlockMath, token: Token): undefined {
  context.enter(node, token)
  context.buffer()
}

/** Finishes the node `open` started: its collected text is its value, plus whatever else is known. */
function close(
  context: CompileContext,
  token: Token,
  fields: (text: string) => Partial<Literal>,
): undefined {
  const text = context.resume()
  const node = context.stack.at(-1)
  /* v8 ignore next -- `open` put this node on the stack; the stack is never empty here. */
  if (node === undefined) return
  Object.assign(node, fields(text))
  context.exit(token)
}

function enterBlock(this: CompileContext, token: Token): undefined {
  open(this, { type: 'math', value: '' }, token)
}

/** A block read from the `$$` fences, or from `$$ … $$` on one line (kept as it was written). */
function exitBlock(this: CompileContext, token: Token): undefined {
  const oneLine = token.start.line === token.end.line
  close(this, token, (text) => {
    const value = oneLine ? text.trim() : text.replaceAll(EDGE_LINE_ENDINGS, '')
    return oneLine
      ? {
          value,
          data: {
            sourceForm: { line: { written: this.sliceSerialize(token).trimEnd(), content: value } },
          },
        }
      : { value }
  })
}

function enterInline(this: CompileContext, token: Token): undefined {
  open(this, { type: 'inlineMath', value: '' }, token)
}

function exitInline(this: CompileContext, token: Token): undefined {
  close(this, token, (value) => ({ value }))
}

/** The formula's characters, which are text of the buffer the node is collecting. */
function exitData(this: CompileContext, token: Token): undefined {
  for (const handlers of [this.config.enter, this.config.exit]) {
    // `data` is among the defaults, which every compile starts from.
    /* v8 ignore next */
    handlers['data']?.call(this, token)
  }
}

export const mathFromMarkdown: Extension = {
  enter: { mathFlow: enterBlock, mathText: enterInline },
  exit: {
    mathFlow: exitBlock,
    mathFlowValue: exitData,
    mathText: exitInline,
    mathTextData: exitData,
  },
}

/**
 * The source of a formula as it can sit between a pair of dollars: a dollar
 * that is not escaped would end it, so it is escaped (TeX's own `\$`), a
 * backslash with nothing to escape would take the closing dollar, so it goes,
 * and a blank line would end the paragraph, so it is a line ending.
 */
export function inlineSource(value: string): string {
  return value
    .trim()
    .replaceAll(/\n[^\S\n]*\n+/gu, '\n')
    .replaceAll(/\\[\s\S]|\$/gu, (match) => (match === '$' ? String.raw`\$` : match))
    .replace(/\\+$/u, (run) => (run.length % 2 === 1 ? run.slice(1) : run))
}

/** A block's source as it can sit between two `$$` lines: none of its own may be a `$$` alone. */
export function blockSource(value: string): string {
  return value
    .split(/\r?\n|\r/u)
    .filter((line) => line.trim() !== '$$')
    .join('\n')
    .replaceAll(EDGE_LINE_ENDINGS, '')
}

export const mathToMarkdown: ToMarkdownExtension = {
  handlers: {
    inlineMath: (node: InlineMath) => {
      const source = inlineSource(node.value)
      return source === '' ? '' : `$${source}$`
    },
    math: (node: BlockMath) => {
      const form = node.data?.sourceForm?.line
      // The one-line spelling is kept for as long as it still says what the block does.
      if (form !== undefined && form.content === node.value) return form.written
      const source = blockSource(node.value)
      return source === '' ? '$$\n$$' : `$$\n${source}\n$$`
    },
  },
}
