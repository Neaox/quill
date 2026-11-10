import type { Nodes, Root } from 'mdast'

/**
 * One HTML comment as CommonMark reads it: `<!--`, then anything up to the
 * first `-->`. `<!-->` and `<!--->` are comments too, empty ones.
 */
const COMMENT = String.raw`<!--(?:-?>|[\s\S]*?-->)`

/** Nothing but comments and the space between them. */
const ONLY_COMMENTS = new RegExp(String.raw`^\s*(?:${COMMENT}\s*)+$`, 'u')

/**
 * An HTML block that opens a comment and never closes it. CommonMark runs
 * such a block to the end of the document, and a browser reads the rest of
 * the page as the comment, so GitHub shows none of it. (Inline HTML is only
 * ever a whole comment, so this can only be a block.)
 */
const UNCLOSED = /^\s*<!--(?![\s\S]*-->)/u

/**
 * Whether raw HTML is only an author's comment (ADR-011, amendment "HTML
 * comments"). A comment is a note to whoever edits the source, not content:
 * the reader, the public site and every rendered surface hide it, as GitHub
 * and CommonMark renderers do, while the source and the editor keep it byte
 * for byte. Raw HTML that holds anything besides comments is not a comment,
 * and is still escaped to text.
 */
export function isHtmlComment(value: string): boolean {
  return ONLY_COMMENTS.test(value) || UNCLOSED.test(value)
}

function withoutComments<T extends Nodes>(node: T): T {
  if (!('children' in node)) return node
  const children = (node.children as Nodes[])
    .filter((child) => child.type !== 'html' || !isHtmlComment(child.value))
    .map(withoutComments)
  return { ...node, children } as T
}

/** The tree with every HTML comment taken out, for text that is read rather than shown. */
export function stripHtmlComments(root: Root): Root {
  return withoutComments(root)
}
