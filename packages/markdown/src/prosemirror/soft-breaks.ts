import type { Root, Text } from 'mdast'
import { visit } from 'unist-util-visit'

import { alertOpening } from '../pipeline/github-alert.ts'
import { rewriteTree } from '../tree.ts'

/**
 * Collapses every soft line break in a tree's text and inline code to a space
 * (a code span reads a line ending as a space anyway): what the editor opens a
 * document with, and so what the first publish from the editor writes, once,
 * as a formatting-only change (ADR-002, ADR-003 requirement 5).
 *
 * One line break is not a soft wrap: the one that ends a GitHub alert's marker
 * line. Joined to its body, `> [!NOTE] Body.` is no longer an alert to GitHub
 * or to the renderer, so it is kept.
 */
export function collapseSoftBreaks(tree: Root): Root {
  const markerLines = new Map<Text, number>()
  visit(tree, 'blockquote', (node) => {
    const opening = alertOpening(node)
    if (opening !== undefined) markerLines.set(opening.text, opening.line)
  })
  return rewriteTree(tree, (node) => {
    if (node.type !== 'text' && node.type !== 'inlineCode') return undefined
    const kept = node.type === 'text' ? (markerLines.get(node) ?? 0) : 0
    const value = node.value.slice(0, kept) + node.value.slice(kept).replaceAll('\n', ' ')
    return [{ ...node, value }]
  })
}
