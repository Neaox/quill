import { extractText } from '@quill/markdown'
import type { SerialisableDocument } from '@quill/markdown'

/**
 * Where a document's title is read from, and where a rename writes it.
 *
 * A document names itself (ADR-005): the front matter `title` when it
 * declares one, and otherwise the first heading of its body. `documents.title`
 * in Postgres is an index of that and nothing more — rebuildable from the
 * content like every other piece of metadata (ADR-034) — which is why a
 * publish re-derives it, and why a rename has to change the document rather
 * than only the column. A rename that touched only the column was silently
 * undone by the next publish.
 */

/** The document tree, named through the package rather than through mdast directly. */
type DocumentTree = SerialisableDocument['ast']
type DocumentNode = DocumentTree['children'][number]
type HeadingNode = Extract<DocumentNode, { type: 'heading' }>

/** The title a document carries: what it declares, or what its first heading says. */
export function documentTitle(
  frontMatter: Record<string, unknown>,
  ast: DocumentTree,
): string | undefined {
  const declared = frontMatter['title']
  return typeof declared === 'string' && declared.length > 0 ? declared : extractText(ast).title
}

/**
 * The document, renamed.
 *
 * Both places the title can live are kept in step. The front matter key is
 * set where it already is, so the keys around it — including the ones this
 * release has never heard of — keep their order and their values (AGENTS.md
 * rule 7); the YAML block itself is edited surgically on the way out, because
 * `serializeDocument` hands the record and the block it was parsed from to
 * `writeFrontMatter`, which rewrites only the keys that changed and leaves
 * comments and quoting exactly as the author wrote them (ADR-002).
 *
 * The heading is rewritten only when it *is* the title. A body whose first
 * heading says something other than what the document is called is a body
 * whose heading is not its name, and a rename has no business editing prose.
 */
export function retitleDocument(
  document: SerialisableDocument,
  title: string,
): SerialisableDocument {
  return {
    frontMatter: withTitle(document.frontMatter, title),
    ast: retitleHeading(document, title),
  }
}

function withTitle(frontMatter: Record<string, unknown>, title: string): Record<string, unknown> {
  const next: Record<string, unknown> = { ...frontMatter }
  // Assigning a key that is already there leaves it where it is; one that is
  // not is appended, which is where a reader expects to find what was added.
  next['title'] = title
  return next
}

interface NamingHeading {
  readonly node: HeadingNode
  readonly index: number
}

/**
 * The heading a document is named by: its first level-one heading, or its
 * first heading of any level, matching what `extractText` reads as the title.
 * Only the top level of the tree is considered — a heading inside a quote or
 * a directive is part of what the document says, not what it is called.
 */
function namingHeading(ast: DocumentTree): NamingHeading | undefined {
  const headings = [...ast.children.entries()]
    .filter((entry): entry is [number, HeadingNode] => entry[1].type === 'heading')
    .map(([index, node]) => ({ node, index }))
  return headings.find((heading) => heading.node.depth === 1) ?? headings[0]
}

function retitleHeading(document: SerialisableDocument, title: string): DocumentTree {
  const { ast } = document
  const heading = namingHeading(ast)
  if (heading === undefined) return ast
  if (headingText(heading.node) !== documentTitle(document.frontMatter, ast)) return ast

  const children = [...ast.children]
  children[heading.index] = { ...heading.node, children: [{ type: 'text', value: title }] }
  return { ...ast, children }
}

/** The heading's own text, read by the same extractor that reads the document's. */
function headingText(heading: HeadingNode): string | undefined {
  return extractText({ type: 'root', children: [heading] }).title
}
