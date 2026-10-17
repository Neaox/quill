import remarkDirective from 'remark-directive'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'
import type { PhrasingContent, Root } from 'mdast'
import { EXIT, visit } from 'unist-util-visit'

import { groupCodeBlocks } from '../code-group/code-group.ts'
import { readDetails } from '../details/read.ts'
import { linksOf, markAutolinkLiterals, withBareAutolinks } from './autolink-literal.ts'
import { withAlertMarkers } from './github-alert.ts'
import { attributesRead, markSourceForm } from './source-form.ts'
import { normaliseMarkdown } from './normalise.ts'
import { GFM_OPTIONS, SERIALISE_OPTIONS } from './options.ts'
import { remarkToMarkdownExtensions } from './to-markdown-extensions.ts'
import type { ToMarkdownExtensionOptions } from './to-markdown-extensions.ts'

/**
 * The one Markdown processor: CommonMark plus GFM, YAML front matter, and
 * directive syntax (ADR-002). It is frozen once and shared, because building a
 * unified pipeline is the expensive part and parsing is not.
 */
function createProcessor(options: ToMarkdownExtensionOptions) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm, GFM_OPTIONS)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkDirective)
    .use(remarkToMarkdownExtensions, options)
    .use(remarkStringify, SERIALISE_OPTIONS)
    .freeze()
}

const processor = createProcessor({ references: true })

/**
 * The same processor for a document with no definitions, which writes a `[`
 * in prose without a backslash (`to-markdown-extensions.ts`). Writing is all
 * it is used for; both read alike.
 */
const writerWithoutReferences = createProcessor({ references: false })

/** Whether a bracket in the tree's prose could be read as a reference to a definition. */
function hasReferenceTargets(tree: Root): boolean {
  let found = false
  visit(tree, ['definition', 'footnoteDefinition', 'rawMdast'], () => {
    found = true
    return EXIT
  })
  return found
}

export function parseMarkdown(markdown: string): Root {
  return parseNormalised(normaliseMarkdown(markdown))
}

/**
 * The tree of Markdown that is already normalised: what `parseMarkdown` does
 * after `normaliseMarkdown`, for a caller that cuts a long document into
 * pieces first and parses each one (`chunk-plan.ts`), and must not normalise a
 * piece whose offsets are the whole document's.
 */
export function parseNormalised(source: string): Root {
  const tree = markSourceForm(processor.parse(source), source, readAttributes)
  return readDetails(groupCodeBlocks(markAutolinkLiterals(tree, source), source), readSummary)
}

/**
 * A summary written between `<summary>` tags, read as the inline Markdown it
 * is (ADR-048): its one paragraph's content, or undefined when it reads as any
 * other block, in which case the HTML around it is left as it was.
 */
function readSummary(text: string): PhrasingContent[] | undefined {
  if (text === '') return []
  const [only, ...rest] = processor.parse(text).children
  return only?.type === 'paragraph' && rest.length === 0 ? only.children : undefined
}

/**
 * The attributes a directive's attribute block reads as, compared as JSON
 * (`source-form.ts`); undefined for a block that does not read as attributes.
 */
function readAttributes(block: string): string | undefined {
  // Read as a text directive on its own line: a root, its paragraph and the
  // directive, and nothing left over.
  let nodes = 0
  let read: string | undefined
  visit(processor.parse(`:x${block}`), (node) => {
    nodes += 1
    if (node.type === 'textDirective') read = attributesRead(node.attributes)
  })
  return nodes === 3 ? read : undefined
}

/**
 * Markdown for a tree. A GitHub alert's marker is written unescaped
 * (`github-alert.ts`), and prose is escaped only where the escape changes how
 * it reads (`to-markdown-extensions.ts`). A bare autolink is written back bare
 * (`autolink-literal.ts`) only when reading the result gives the same links;
 * otherwise the whole tree is written in the ordinary form, which always
 * reads back as itself.
 */
export function stringifyMdast(tree: Root): string {
  const writer = hasReferenceTargets(tree) ? processor : writerWithoutReferences
  const alerts = withAlertMarkers(tree)
  const { tree: bare, bare: count } = withBareAutolinks(alerts)
  if (count === 0) return writer.stringify(alerts)
  const written = writer.stringify(bare)
  return linksOf(processor.parse(written)) === linksOf(tree) ? written : writer.stringify(alerts)
}
