import { describe, expect, it } from 'vitest'
import type { Link, Root } from 'mdast'

import { mdastToProseMirror } from '../prosemirror/from-mdast.ts'
import { proseMirrorToMdast } from '../prosemirror/to-mdast.ts'
import { markAutolinkLiterals, withBareAutolinks } from './autolink-literal.ts'
import { parseDocument } from './parse-document.ts'
import { parseMarkdown, stringifyMdast } from './processor.ts'
import { serializeDocument } from './serialize-document.ts'

/**
 * A GFM autolink literal is written back bare, as its author wrote it, and an
 * angle-bracket autolink keeps its brackets (ADR-002): saving must not rewrite
 * `https://example.com` as `<https://example.com>`.
 */

function saved(markdown: string): string {
  const parsed = parseDocument(markdown)
  const { doc } = mdastToProseMirror(parsed.ast)
  return serializeDocument({ frontMatter: parsed.frontMatter, ast: proseMirrorToMdast(doc).tree })
}

const link = (overrides: Partial<Link>): Link => ({
  type: 'link',
  url: 'https://example.com',
  title: null,
  children: [{ type: 'text', value: 'https://example.com' }],
  data: { autolinkLiteral: true },
  ...overrides,
})
const root = (child: Link): Root => ({
  type: 'root',
  children: [{ type: 'paragraph', children: [child] }],
})

const BYTE_FOR_BYTE = [
  'https://example.com',
  'www.example.com',
  'user@example.com',
  'See https://example.com.',
  '(see https://example.com)',
  'An address such as https://x.y/a:b reads as one.',
  'Write to user@example.com, or visit www.example.com/docs?a=1_b.',
  '<https://example.com>',
  'Mail <user@example.com> now',
]

describe('autolinks on a save', () => {
  it.each(BYTE_FOR_BYTE)('keep %s byte for byte', (line) => {
    const source = `${line}\n`
    expect(stringifyMdast(parseMarkdown(source))).toBe(source)
    expect(saved(source)).toBe(source)
  })

  it('fall back to brackets when bare text would read back as a different link', () => {
    // An edit that runs the following words up against the address.
    const tree = root(link({}))
    const [paragraph] = tree.children
    if (paragraph?.type === 'paragraph') paragraph.children.push({ type: 'text', value: 'abc' })
    expect(stringifyMdast(tree)).toBe('<https://example.com>abc\n')
  })

  it('write a link whose address no longer matches its words in the ordinary form', () => {
    expect(stringifyMdast(root(link({ url: 'https://elsewhere.test' })))).toBe(
      '[https://example.com](https://elsewhere.test)\n',
    )
  })
})

describe('marking and writing autolink literals', () => {
  it('leaves a link with no source position unmarked', () => {
    const unplaced = link({ data: undefined })
    markAutolinkLiterals(root(unplaced), 'https://example.com')
    expect(unplaced.data).toBeUndefined()
  })

  it('writes a marked link bare only while it is a bare address with nothing more', () => {
    expect(withBareAutolinks(root(link({}))).bare).toBe(1)
    expect(withBareAutolinks(root(link({ title: 'T' }))).bare).toBe(0)
    expect(withBareAutolinks(root(link({ children: [] }))).bare).toBe(0)
    expect(
      withBareAutolinks(root(link({ children: [{ type: 'inlineCode', value: 'x' }] }))).bare,
    ).toBe(0)
    expect(withBareAutolinks(root(link({ url: 'https://elsewhere.test' }))).bare).toBe(0)
  })
})
