// unified/remark pipeline: markdown <-> mdast.
// Parse and serialise options are fixed so serialisation is deterministic (ADR-002).
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import remarkDirective from 'remark-directive'
import remarkStringify from 'remark-stringify'
import type { Root } from 'mdast'

// The canonical serialisation profile. Every one of these choices is a place
// where an author's original formatting may be normalised (see R3 Q4).
export const stringifyOptions = {
  bullet: '-',
  bulletOrdered: '.',
  emphasis: '*',
  strong: '*',
  fence: '`',
  fences: true,
  rule: '-',
  ruleRepetition: 3,
  listItemIndent: 'one',
  incrementListMarker: true,
  tightDefinitions: true,
  setext: false,
  resourceLink: false,
} as const

// remark-stringify escapes a literal "::" at the start of a text node as "\::",
// which re-parses as a text node ":" followed by a text directive. In other
// words the serialiser INVENTS a directive. Escaping both colons fixes it.
// remark-stringify discards an `extensions` option, so the pattern has to be
// pushed onto `toMarkdownExtensions` by a plugin.
// Cost: a literal "::" anywhere in prose is written as "\:\:".
function remarkEscapeDirectiveColons(this: any) {
  const data = this.data()
  const list = data.toMarkdownExtensions || (data.toMarkdownExtensions = [])
  list.push({
    unsafe: [
      { character: ':', after: ':' },
      { character: ':', before: ':' },
    ],
  })
}

// With the default (true), every cell is padded to its column width, so editing
// one cell rewrites every row of the table in the Git diff. With false the
// serialiser writes "| a | b |" and only the changed row moves.
// Set R3_TABLE_PIPE_ALIGN=0 to measure the difference.
export const tablePipeAlign = process.env.R3_TABLE_PIPE_ALIGN !== '0'

const base = unified()
  .use(remarkParse)
  .use(remarkGfm, { tablePipeAlign })
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkDirective)

const parser = base()
const serialiser = base().use(remarkEscapeDirectiveColons).use(remarkStringify, stringifyOptions)()

export function parseMarkdown(md: string): Root {
  return parser.parse(md) as Root
}

export function stringifyMdast(tree: Root): string {
  return serialiser.stringify(tree as never)
}
