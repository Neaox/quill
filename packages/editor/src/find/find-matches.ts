import type { Node as PMNode } from '@tiptap/pm/model'

import { blockText, ELEMENT } from './block-text.ts'
import { matchesIn } from './find-pattern.ts'
import type { CompiledPattern } from './find-pattern.ts'

/**
 * Every place a pattern is found in a document.
 *
 * A line of text is searched as one string, across its marks, so a half-bold word is found whole. A
 * match never runs from one block into the next, and never across the edge of an inline element
 * (a badge, a label) where the document is not continuous, because replacing it would take the
 * element's own tokens; nor one that takes in an image, which a replacement would delete. Code blocks are not searched: they are drawn by their own editor, which the
 * highlights cannot reach. Searching is lazy to a limit, so a pattern that matches everything in a
 * long document costs a bounded amount and says so.
 */

export interface Match {
  readonly from: number
  readonly to: number
}

/** A match with what the pattern captured, which a replacement may take apart. */
export interface FoundMatch extends Match {
  readonly captured: RegExpExecArray
}

export interface Found {
  readonly matches: readonly FoundMatch[]
  /** There were more than the limit; the rest were not looked for. */
  readonly truncated: boolean
}

/** More than anyone steps through; past it the count says "10,000+". */
export const MAX_MATCHES = 10_000

export function findMatches(
  doc: PMNode,
  pattern: CompiledPattern,
  scope?: Match,
  limit: number = MAX_MATCHES,
): Found {
  const matches: FoundMatch[] = []
  const from = scope?.from ?? 0
  const to = scope?.to ?? doc.content.size
  let truncated = false
  doc.nodesBetween(from, to, (node, position) => {
    if (truncated || node.type.spec.code === true) return false
    if (!node.isTextblock) return true
    const block = blockText(node, position)
    for (const match of matchesIn(block.text, pattern.regex)) {
      // A match that takes in an image or other element would replace it with text.
      if (match[0].includes(ELEMENT)) continue
      const start = block.positionAt(match.index)
      const end = block.positionAt(match.index + match[0].length - 1) + 1
      // A match across the edge of an inline element is not one stretch of the document.
      if (end - start !== match[0].length || start < from || end > to) continue
      if (matches.length === limit) {
        truncated = true
        break
      }
      matches.push({ from: start, to: end, captured: match })
    }
    return false
  })
  return { matches, truncated }
}
