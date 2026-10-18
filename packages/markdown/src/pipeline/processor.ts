import remarkDirective from 'remark-directive'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'
import type { PhrasingContent, Root } from 'mdast'
import { EXIT, visit } from 'unist-util-visit'

import { groupCodeBlocks } from '../code-group/code-group.ts'
import { readLinkComments, writeLinkComments } from '../directives/link-comment.ts'
import { readDetails } from '../details/read.ts'
import { linksOf, markAutolinkLiterals, withBareAutolinks } from './autolink-literal.ts'
import { withAlertMarkers } from './github-alert.ts'
import { attributesRead, markSourceForm } from './source-form.ts'
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

const LINE_ENDINGS = /\r\n?/g
const BYTE_ORDER_MARK = '﻿'

/**
 * The two formatting-only normalisations a document goes through before it is
 * parsed at all, so nothing downstream has to think about either.
 *
 * **Line endings become `\n`.** A `\r` survives micromark into a code block's
 * value and into prose, and from there into the rendered HTML — where a
 * browser's parser drops it again while building the text node. Every offset
 * the server computed over that text (the packed token ranges of ADR-030 above
 * all) would then point one character further along on every line after the
 * first, so a CRLF document's code blocks were highlighted in the wrong places.
 * Normalising once here is what makes an offset mean the same thing on both
 * sides. It also keeps serialisation deterministic: a tree carrying `\r\n`
 * inside one node and `\n` in the next writes a file with mixed line endings.
 *
 * **A leading byte-order mark is dropped.** remark discards it anyway; doing it
 * here is what lets the fidelity documentation state it as a known change.
 *
 * Both are formatting-only, and the README's fidelity levels list them with the
 * other normalisations a document meets the first time it is opened.
 */
function normalise(markdown: string): string {
  const withoutMark = markdown.startsWith(BYTE_ORDER_MARK) ? markdown.slice(1) : markdown
  return withoutMark.replaceAll(LINE_ENDINGS, '\n')
}

export function parseMarkdown(markdown: string): Root {
  const source = normalise(markdown)
  const tree = markSourceForm(processor.parse(source), source, readAttributes)
  return readLinkComments(
    readDetails(groupCodeBlocks(markAutolinkLiterals(tree, source), source), readSummary),
  )
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
export function stringifyMdast(document: Root): string {
  const tree = writeLinkComments(document)
  const writer = hasReferenceTargets(tree) ? processor : writerWithoutReferences
  const alerts = withAlertMarkers(tree)
  const { tree: bare, bare: count } = withBareAutolinks(alerts)
  if (count === 0) return writer.stringify(alerts)
  const written = writer.stringify(bare)
  return linksOf(processor.parse(written)) === linksOf(tree) ? written : writer.stringify(alerts)
}
