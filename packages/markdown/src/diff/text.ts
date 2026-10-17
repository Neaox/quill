import type { Nodes } from 'mdast'

/**
 * The words a node shows, with a space wherever one block ends and the next
 * begins: `mdast-util-to-string` runs every list item and table cell
 * together ("onetwothree"), which is right for a heading's slug and wrong for
 * counting words or judging how alike two blocks are.
 */
export function plainText(node: Nodes): string {
  if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? ''
  if ('value' in node && typeof node.value === 'string') return node.value
  if (node.type === 'diffCode') {
    return node.lines
      .map((line) => line.segments.map((segment) => segment.text).join(''))
      .join('\n')
  }
  if (!('children' in node)) return ''
  const children: readonly Nodes[] = node.children
  return children.map(plainText).join(INLINE_PARENTS.has(node.type) ? '' : ' ')
}

/** Nodes whose children are words in a line, joined as they are. */
const INLINE_PARENTS = new Set([
  'paragraph',
  'heading',
  'tableCell',
  'emphasis',
  'strong',
  'delete',
  'link',
  'linkReference',
  'textDirective',
  'diffInsertion',
  'diffDeletion',
])
