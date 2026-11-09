import type { List, ListItem, PhrasingContent, RootContent } from 'mdast'

import { emojiNameOf } from '../emoji/emoji.ts'
import { BlockRenderError } from './define.ts'

/**
 * A line of phrasing read as text, for a block whose meaning is in the shape
 * an author wrote: a route's arrows, a step's first line, a cast member's
 * name and words.
 *
 * Patterns are easiest to say over text, and what they find has to be drawn
 * as Markdown, with its bold, its code, its links and its emoji. So the line
 * is written out as its plain text, with every other node standing in its
 * place as a token: an emoji as `EMOJI_TOKEN`, anything else (bold, code, a
 * link, another directive) as `NODE_TOKEN`. A pattern runs over that text,
 * and `phrasingOf` turns each piece it finds back into the nodes it was
 * written with. A token is made of characters from Unicode's private use
 * area, which no author types and no pattern here matches by accident.
 */

const NODE = ''
const EMOJI = ''
const END = ''

/** A node that is not plain text, in a pattern; its index is the first group. */
export const NODE_TOKEN = `${NODE}(\\d+)${END}`
/** An emoji the page draws, in a pattern; its index is the first group. */
export const EMOJI_TOKEN = `${EMOJI}(\\d+)${END}`
/** The same, without a group: for a lookahead, or a pattern a line is split by. */
export const ANY_EMOJI_TOKEN = `${EMOJI}\\d+${END}`
/** A shortcode no emoji answers to, which stays as written (ADR-038). */
export const LITERAL_SHORTCODE = ':[a-z0-9_+-]+:'

const TOKENS = new RegExp(`([${NODE}${EMOJI}])(\\d+)${END}`, 'gu')

const PHRASING: ReadonlySet<string> = new Set([
  'text',
  'emphasis',
  'strong',
  'delete',
  'inlineCode',
  'break',
  'link',
  'linkReference',
  'image',
  'imageReference',
  'footnoteReference',
  'textDirective',
  'html',
])

/** Whether a node is phrasing: what a paragraph, a label or an inline block holds. */
export function isPhrasing(node: RootContent): node is PhrasingContent {
  return PHRASING.has(node.type)
}

export interface Line {
  /** The line's plain text, with a token for each node that is not. */
  readonly text: string
  /** The nodes the tokens stand for, by index. */
  readonly nodes: readonly PhrasingContent[]
}

function isPlainText(node: PhrasingContent): boolean {
  return node.type === 'text' && emojiNameOf(node) === undefined
}

/** A run of phrasing, read as a line of text. */
export function lineOf(children: readonly PhrasingContent[]): Line {
  const nodes: PhrasingContent[] = []
  const text = children
    .map((child) => {
      if (child.type === 'text' && isPlainText(child)) return child.value
      nodes.push(child)
      const marker = emojiNameOf(child) === undefined ? NODE : EMOJI
      return `${marker}${String(nodes.length - 1)}${END}`
    })
    .join('')
  return { text, nodes }
}

/** The node a token's index names, or undefined. */
export function nodeAt(line: Line, index: string | undefined): PhrasingContent | undefined {
  return index === undefined ? undefined : line.nodes[Number(index)]
}

/** A piece of a line's text, as the nodes it was written with. */
export function phrasingOf(line: Line, text: string): PhrasingContent[] {
  const pieces: PhrasingContent[] = []
  let from = 0
  for (const match of text.matchAll(TOKENS)) {
    if (match.index > from) pieces.push({ type: 'text', value: text.slice(from, match.index) })
    pieces.push(...line.nodes.slice(Number(match[2]), Number(match[2]) + 1))
    from = match.index + match[0].length
  }
  if (from < text.length) pieces.push({ type: 'text', value: text.slice(from) })
  return pieces
}

/**
 * The one line each item of a block's list holds, for a block that is a
 * list and nothing else (a cast's members, a list of checks). Each item is
 * one line: anything more would have nowhere to go, so the block says so,
 * through the frame of a block that cannot be drawn, rather than dropping it.
 */
export function linesOf(
  children: readonly RootContent[],
  kind: 'bullets' | 'numbers',
  name: string,
  holds: string,
): PhrasingContent[][] {
  const lists = children.filter((child): child is List => child.type === 'list')
  if (lists.length === 0 || lists.length !== children.length) {
    throw new BlockRenderError(`${name} holds ${holds}, and nothing else`)
  }
  if (lists.some((list) => (list.ordered === true) !== (kind === 'numbers'))) {
    throw new BlockRenderError(`${name} holds ${holds}`)
  }
  return lists.flatMap((list) =>
    list.children.map((item: ListItem) => {
      const [only] = item.children
      if (item.children.length !== 1 || only?.type !== 'paragraph') {
        throw new BlockRenderError(`each item of ${name} is one line`)
      }
      return only.children
    }),
  )
}
