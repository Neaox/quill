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
  // A parsed image always has its place, and starts with its own `![`.
  /* v8 ignore next */
  if (start === undefined || source.slice(start, start + 2) !== '![') return undefined
  let depth = 0
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source.charAt(index)
    if (character === '\\') index += 1
    else if (character === '[') depth += 1
    else if (character === ']' && --depth === 0) return source.slice(start + 2, index)
  }
  // An image the parser read always closes its label.
  /* v8 ignore next */
  return undefined
}

/** Plain text, with a directive as the words it was written as in `label`. */
function plainText(node: Nodes | RootContent, label: string): string {
  if (node.type === 'textDirective') {
    // A directive the parser read always has its place in the label.
    /* v8 ignore start */
    const start = node.position?.start.offset ?? 0
    const end = node.position?.end.offset ?? 0
    /* v8 ignore stop */
    return label.slice(start, end)
  }
  // The parser gives every image its alternative text, if only an empty one.
  /* v8 ignore next */
  if (node.type === 'image') return node.alt ?? ''
  if ('value' in node) return node.value
  if ('children' in node) return node.children.map((child) => plainText(child, label)).join('')
  // A hard break, which reads as a space.
  return ' '
}

/** The tree with each image's alternative text read as CommonMark reads it. */
export function readImageAlts(tree: Root, source: string, parse: (label: string) => Root): Root {
  visit(tree, 'image', (node) => {
    const label = writtenLabel(source, node)
    if (label === undefined || !label.includes(':')) return
    const [only, ...rest] = parse(label).children
    // A label is phrasing, but read on its own `# a: b` would be a heading.
    if (only?.type !== 'paragraph' || rest.length > 0) return
    node.alt = plainText(only, label)
  })
  return tree
}
