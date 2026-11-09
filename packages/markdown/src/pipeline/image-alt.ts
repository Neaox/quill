import type { Nodes, Root, RootContent } from 'mdast'
import { visit } from 'unist-util-visit'

/**
 * An image's alternative text, with the words a directive swallowed given
 * back.
 *
 * An image's alternative text is the plain text of its label (CommonMark
 * 6.4), and mdast takes it from the phrasing the label was read as. With
 * directives on, `JSON:API` in a label reads as `JSON` and a text directive
 * named `API` with no content, and its plain text is empty, so the image is
 * described as "JSON" and the save writes the label without `:API`. Text
 * cannot hold a directive, so in alternative text a directive is the words it
 * was written as.
 *
 * Only a label that holds a colon can hold a directive, so no other image is
 * read twice.
 */

/** The label an image was written with, between `![` and its `]`, or undefined. */
export function writtenLabel(source: string, node: Nodes): string | undefined {
  const start = node.position?.start.offset
  if (start === undefined || source.slice(start, start + 2) !== '![') return undefined
  let depth = 0
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source.charAt(index)
    if (character === '\\') index += 1
    else if (character === '[') depth += 1
    else if (character === ']' && --depth === 0) return source.slice(start + 2, index)
  }
  return undefined
}

/** Plain text, with a directive as the words it was written as in `label`. */
function plainText(node: Nodes | RootContent, label: string): string {
  if (node.type === 'textDirective') {
    const { start, end } = node.position ?? {}
    return start?.offset === undefined || end?.offset === undefined
      ? ''
      : label.slice(start.offset, end.offset)
  }
  if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? ''
  if ('value' in node && typeof node.value === 'string') return node.value
  if ('children' in node) return node.children.map((child) => plainText(child, label)).join('')
  return ''
}

/** The tree with each image's alternative text read as CommonMark reads it. */
export function readImageAlts(tree: Root, source: string, parse: (label: string) => Root): Root {
  visit(tree, 'image', (node) => {
    const label = writtenLabel(source, node)
    if (label === undefined || !label.includes(':')) return
    const [only, ...rest] = parse(label).children
    if (only?.type !== 'paragraph' || rest.length > 0) return
    node.alt = plainText(only, label)
  })
  return tree
}
