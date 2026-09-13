import type { Root, Yaml } from 'mdast'

import { readFrontMatter } from '../front-matter/yaml-document.ts'
import type { Warning } from '../warnings.ts'
import { parseMarkdown } from './processor.ts'

/** The working representation of a document (ADR-004): metadata, tree, and what went wrong. */
export interface SerialisableDocument {
  readonly frontMatter: Record<string, unknown>
  readonly ast: Root
}

export interface ParsedDocument extends SerialisableDocument {
  readonly warnings: readonly Warning[]
}

/** The front matter block, which CommonMark only recognises as the first thing in a file. */
export function frontMatterNode(ast: Root): Yaml | undefined {
  const first = ast.children[0]
  return first?.type === 'yaml' ? first : undefined
}

/**
 * Parses a document into front matter and an mdast tree. The tree keeps the front
 * matter node with its YAML verbatim, so a serialise that changes nothing writes
 * the original bytes back (ADR-002).
 *
 * Line endings and a leading byte-order mark are normalised once, here, by
 * `parseMarkdown`: a document written with CRLF comes back with LF, which is the
 * one formatting change a parse makes and the reason a rendered code block's
 * token offsets match the text node a browser builds from it.
 */
export function parseDocument(markdown: string): ParsedDocument {
  const ast = parseMarkdown(markdown)
  const node = frontMatterNode(ast)
  if (node === undefined) return { frontMatter: {}, ast, warnings: [] }
  const { value, warnings } = readFrontMatter(node.value)
  return { frontMatter: value, ast, warnings }
}
