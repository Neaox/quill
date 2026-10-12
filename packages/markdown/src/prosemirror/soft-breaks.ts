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
 * One line break is not a soft wrap: the one that ends a callout's marker line,
 * `> [!NOTE]` or `> [!tip] Its title`. Joined to its body, the body is no longer
 * a body but a title, and a GitHub alert is no longer an alert, so it is kept.
 */
export function collapseSoftBreaks(tree: Root): Root {
  const kept = new Map<Text, number>()
  visit(tree, 'blockquote', (node) => {
    const end = alertOpening(node)?.lineEnd
    if (end !== undefined) kept.set(end.text, end.after)
  })
  return rewriteTree(tree, (node) => {
    if (node.type !== 'text' && node.type !== 'inlineCode') return undefined
    // What is before the marker line's break is the marker and its title, which have no
    // other breaks; what is after it is the body, whose soft wraps collapse.
    const keep = node.type === 'text' ? (kept.get(node) ?? 0) : 0
    const value = node.value.slice(0, keep) + node.value.slice(keep).replaceAll('\n', ' ')
    return [{ ...node, value }]
  })
}
