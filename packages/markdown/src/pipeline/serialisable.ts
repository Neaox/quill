import { toString } from 'mdast-util-to-string'
import type { Root, Text } from 'mdast'

import { rewriteTree } from '../tree.ts'
import type { Warning } from '../warnings.ts'
import { warning } from '../warnings.ts'

/**
 * Every node type the configured serialiser can write: CommonMark, GFM, YAML
 * front matter, directives, and this package's own escape hatch. A node of any
 * other type would make `mdast-util-to-markdown` throw, so it is degraded to its
 * text content instead (AGENTS.md rule 7).
 */
export const SERIALISABLE_TYPES: ReadonlySet<string> = new Set([
  'blockquote',
  'break',
  'code',
  'containerDirective',
  'definition',
  'delete',
  'emphasis',
  'footnoteDefinition',
  'footnoteReference',
  'heading',
  'html',
  'image',
  'imageReference',
  'inlineCode',
  'leafDirective',
  'link',
  'linkReference',
  'list',
  'listItem',
  'paragraph',
  'rawMdast',
  'root',
  'strong',
  'table',
  'tableCell',
  'tableRow',
  'text',
  'textDirective',
  'thematicBreak',
  'yaml',
])

/**
 * Node types whose children are phrasing content, where a replacement has to be
 * a text node rather than a paragraph.
 */
const PHRASING_PARENTS: ReadonlySet<string> = new Set([
  'delete',
  'emphasis',
  'footnoteReference',
  'heading',
  'link',
  'linkReference',
  'paragraph',
  'strong',
  'tableCell',
  'textDirective',
])

/**
 * Rewrites any node the serialiser cannot write into escaped text holding its
 * text content, so `serializeDocument` is total (AGENTS.md rule 7).
 *
 * The degraded form is *text*, not Markdown. `rawMdast` writes its value
 * verbatim with no escaping of any kind, which is right for source this package
 * chose to carry through untouched and wrong for the text content of a node
 * nothing understood: a node whose text happened to read `# Heading` or `- item`
 * came back as a heading or a list, turning content into structure, and one
 * reading `:::callout` came back as a directive. An escaped node cannot do that.
 *
 * In flow content the replacement is a paragraph, which is what a block of text
 * is and what keeps two degraded blocks from running into one line; in phrasing
 * content it is a bare text node, because a paragraph cannot go there.
 */
export function replaceUnserialisable(tree: Root): { tree: Root; warnings: Warning[] } {
  const warnings: Warning[] = []
  const result = rewriteTree(tree, (node, parentType) => {
    if (SERIALISABLE_TYPES.has(node.type)) return undefined
    warnings.push(warning('unserialisable-node', node.type))
    const text: Text = { type: 'text', value: toString(node) }
    return PHRASING_PARENTS.has(parentType) ? [text] : [{ type: 'paragraph', children: [text] }]
  })
  return { tree: result, warnings }
}
