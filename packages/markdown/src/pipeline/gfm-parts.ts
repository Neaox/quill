import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal'
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote'
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough'
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table'
import { gfmTaskListItemFromMarkdown } from 'mdast-util-gfm-task-list-item'
import { gfmAutolinkLiteral } from 'micromark-extension-gfm-autolink-literal'
import { gfmFootnote } from 'micromark-extension-gfm-footnote'
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough'
import { gfmTable } from 'micromark-extension-gfm-table'
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item'
import { combineExtensions } from 'micromark-util-combine-extensions'
import type { Processor } from 'unified'

import { GFM_OPTIONS } from './options.ts'

/**
 * GitHub's Markdown for reading only, as `remark-gfm` composes it (the same
 * parts, in the same order, with the same options), but with the two most
 * costly parts optional: tables, and literal autolinks (`www.…`, `https://…`
 * and addresses). Together they were two thirds of what the extensions cost
 * a parse (ADR-062, step 3), and both run on every line or every word of a
 * text whether or not it holds one.
 *
 * A part is left out only of text that cannot hold what it reads
 * (`gfmPartsNeeded`), so the tree is the one `remark-gfm` gives: leaving a
 * part out skips work and never changes a node.
 */

export interface GfmParts {
  readonly table: boolean
  readonly autolinkLiteral: boolean
}

/**
 * Which of the optional parts a text could need. Erring one way only: a
 * part is needed unless the text plainly cannot hold one.
 *
 * - **A table** has a delimiter row, and a GFM table needs a `|` in its
 *   source; a character reference cannot make one, because a table is read
 *   from the source's own characters.
 * - **A literal autolink** starts at `www`, at `http:` or `https:`, or has an
 *   `@`, in any letter case. It is also read from text after character
 *   references are decoded, so a text with any `&` may spell one, and counts
 *   as needing it.
 */
export function gfmPartsNeeded(text: string): GfmParts {
  return {
    table: text.includes('|'),
    autolinkLiteral: /[@&]|www|https?:/iu.test(text),
  }
}

/** A `unified` plugin: GFM's micromark and mdast extensions, with the optional parts as asked. */
export function remarkGfmParts(this: Processor, parts: GfmParts): void {
  const data = this.data()
  const micromark = (data.micromarkExtensions ??= [])
  const fromMarkdown = (data.fromMarkdownExtensions ??= [])
  micromark.push(
    combineExtensions([
      ...(parts.autolinkLiteral ? [gfmAutolinkLiteral()] : []),
      gfmFootnote(),
      gfmStrikethrough(GFM_OPTIONS),
      ...(parts.table ? [gfmTable()] : []),
      gfmTaskListItem(),
    ]),
  )
  fromMarkdown.push([
    ...(parts.autolinkLiteral ? [gfmAutolinkLiteralFromMarkdown()] : []),
    gfmFootnoteFromMarkdown(),
    gfmStrikethroughFromMarkdown(),
    ...(parts.table ? [gfmTableFromMarkdown()] : []),
    gfmTaskListItemFromMarkdown(),
  ])
}
