import { toString } from 'mdast-util-to-string'
import type { Paragraph, Root } from 'mdast'

import { stripAuthoringBlocks } from '../directives/strip-authoring-blocks.ts'
import { stripPresenterNotes } from '../directives/strip-presenter-notes.ts'

/**
 * What a document says it is about, for the lists that show it under its
 * title (ADR-056): its front matter's `description`, or else its first
 * top-level paragraph, as plain words. Cut at a word near `SUMMARY_LIMIT`
 * characters, so a long opening paragraph is a line or two, not a page.
 */

export const SUMMARY_LIMIT = 240

/**
 * An icon is one emoji, as one user-perceived character, in at most this many
 * UTF-16 code units: longer than any emoji Unicode recommends, the longest
 * flag sequences included.
 */
const ICON_LIMIT = 16

/** One emoji Unicode recommends for general interchange, whatever sequence draws it. */
const ONE_EMOJI = /^\p{RGI_Emoji}$/v

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function clip(text: string): string {
  if (text.length <= SUMMARY_LIMIT) return text
  const cut = text.slice(0, SUMMARY_LIMIT)
  const space = cut.lastIndexOf(' ')
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`
}

function words(value: string): string | undefined {
  const text = value.replaceAll(/\s+/g, ' ').trim()
  return text === '' ? undefined : clip(text)
}

export function documentSummary(
  ast: Root,
  frontMatter: Readonly<Record<string, unknown>>,
): string | undefined {
  const description = frontMatter['description']
  if (typeof description === 'string') {
    const written = words(description)
    if (written !== undefined) return written
  }
  const { ast: published } = stripAuthoringBlocks(stripPresenterNotes(ast))
  const first = published.children.find(
    (node): node is Paragraph => node.type === 'paragraph' && words(toString(node)) !== undefined,
  )
  return first === undefined ? undefined : words(toString(first))
}

/**
 * The document's own icon from its front matter (`icon: 🚀`), or undefined.
 *
 * It is drawn beside the title wherever the title is listed, so it is held to
 * exactly what the name promises: one emoji. A word, a sentence, a run of
 * emoji or a control character that turns the title round is no icon at all,
 * because anything else here is words beside a title that nobody wrote there.
 */
export function documentIcon(frontMatter: Readonly<Record<string, unknown>>): string | undefined {
  const icon = frontMatter['icon']
  if (typeof icon !== 'string') return undefined
  const trimmed = icon.trim()
  if (trimmed === '' || trimmed.length > ICON_LIMIT) return undefined
  if ([...graphemes.segment(trimmed)].length !== 1) return undefined
  return ONE_EMOJI.test(trimmed) ? trimmed : undefined
}
