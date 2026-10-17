import { describe, expect, it } from 'vitest'
import type { Root } from 'mdast'

import { mdastToProseMirror } from '../prosemirror/from-mdast.ts'
import { liftLayout, wrapLayout } from '../prosemirror/layout.ts'
import { proseMirrorToMdast } from '../prosemirror/to-mdast.ts'
import { parseDocument } from './parse-document.ts'
import { parseMarkdown, stringifyMdast } from './processor.ts'
import { serializeDocument } from './serialize-document.ts'

/**
 * GitHub's alerts (`> [!NOTE]` and its four siblings) are written back as
 * alerts (research 2026-10-11, P0-7). An escaped marker, `> \[!NOTE]`, is a
 * plain quote to GitHub, GitLab and Obsidian, so the first save from the editor
 * used to turn every alert in a document into one.
 */

/** Byte offsets are not semantics. */
function semantics(tree: Root): string {
  return JSON.stringify(tree, (key, value: unknown) =>
    key === 'position' || value === null ? undefined : value,
  )
}

/** The first save from the editor: soft wraps collapsed, layout lifted and wrapped again. */
function saved(markdown: string): string {
  const parsed = parseDocument(markdown)
  const { doc } = mdastToProseMirror(parsed.ast, { softBreaks: 'collapse' })
  return serializeDocument({
    frontMatter: parsed.frontMatter,
    ast: proseMirrorToMdast(wrapLayout(liftLayout(doc))).tree,
  })
}

const KINDS = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']

/** Each kind as GitHub documents it, in lower case, and capitalised: GitHub reads all three. */
const MARKERS = KINDS.flatMap((kind) => [
  kind,
  kind.toLowerCase(),
  `${kind.charAt(0)}${kind.slice(1).toLowerCase()}`,
])

const SHAPES: readonly (readonly [string, (marker: string) => string])[] = [
  ['with a body', (marker) => `> [!${marker}]\n> Read this first.\n`],
  ['without a body', (marker) => `> [!${marker}]\n`],
  ['with several blocks', (marker) => `> [!${marker}]\n> One.\n>\n> - two\n> - three\n`],
  ['inside a list item', (marker) => `- An item.\n\n  > [!${marker}]\n  > Read this first.\n`],
  ['inside a quote', (marker) => `> > [!${marker}]\n> > Read this first.\n`],
  ['holding a quote', (marker) => `> [!${marker}]\n>\n> > Quoted.\n`],
  [
    'beside an ordinary quote',
    (marker) => `> Just a quote.\n\n> [!${marker}]\n> Read this first.\n`,
  ],
]

const CASES = MARKERS.flatMap((marker) =>
  SHAPES.map(([shape, write]) => ({ marker, shape, source: write(marker) })),
)

describe('GitHub alerts on a save', () => {
  it.each(CASES)('keep [!$marker] $shape byte for byte', ({ source }) => {
    expect(stringifyMdast(parseMarkdown(source))).toBe(source)
    expect(saved(source)).toBe(source)
  })

  it('keep the marker on its own line when the body’s soft wraps collapse', () => {
    const source = '> [!WARNING]\n> The first line\n> and the second.\n'

    expect(stringifyMdast(parseMarkdown(source))).toBe(source)
    expect(saved(source)).toBe('> [!WARNING]\n> The first line and the second.\n')
  })

  it('keep a marker with a trailing space an alert', () => {
    // Two trailing spaces would be a hard break, which is not part of the marker.
    expect(saved('> [!TIP] \n> Body.\n')).toBe('> [!TIP]\n> Body.\n')
    expect(saved('> [!TIP]\t\n> Body.\n')).toBe('> [!TIP]\n> Body.\n')
  })

  it('leave a marker that is not the first line of a quote to the ordinary rules', () => {
    // None of these is an alert, to GitHub or to the renderer, so none is
    // written as one; each reads back exactly as it was read.
    const sources = [
      '> Body first.\n> [!NOTE]\n',
      '> [!NOTE] on the same line as its words.\n',
      '> \\[!NOTE](https://example.com)\n',
      '[!NOTE]\n> Body.\n',
      '> [!UNKNOWN]\n> Body.\n',
      '> *[!NOTE]*\n> Body.\n',
    ]
    for (const source of sources) {
      const tree = parseMarkdown(source)
      expect(semantics(parseMarkdown(stringifyMdast(tree)))).toBe(semantics(tree))
    }
  })

  it('still escape a marker that would read back as a reference', () => {
    // With a definition for `!note`, an unescaped `[!NOTE]` is a link. Only the
    // backslash keeps the author's text, so it must survive the save.
    const source = '> \\[!NOTE]\n> Body.\n\n[!note]: https://example.com\n'
    const tree = parseMarkdown(source)

    expect(semantics(parseMarkdown(stringifyMdast(tree)))).toBe(semantics(tree))
    expect(stringifyMdast(tree)).toContain('\\[!NOTE]')
  })

  it('write an alert the editor built as an alert', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'blockquote',
          children: [{ type: 'paragraph', children: [{ type: 'text', value: '[!NOTE]\nBody.' }] }],
        },
      ],
    }

    expect(stringifyMdast(tree)).toBe('> [!NOTE]\n> Body.\n')
  })
})
