import { readFileSync, readdirSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { Root } from 'mdast'
import type { Node as PMNode } from 'prosemirror-model'
import { visit } from 'unist-util-visit'

import { parseDocument } from '../pipeline/parse-document.ts'
import { parseMarkdown } from '../pipeline/processor.ts'
import { serializeDocument } from '../pipeline/serialize-document.ts'
import { mdastToProseMirror } from './from-mdast.ts'
import { liftLayout, wrapLayout } from './layout.ts'
import { schema } from './schema.ts'
import { proseMirrorToMdast } from './to-mdast.ts'

/**
 * The first save from the editor, over real documents (research 2026-10-11,
 * section 2.9 and P0-7).
 *
 * A document opened in the editor and saved unchanged goes through
 * `parseDocument → mdastToProseMirror(collapse) → liftLayout → wrapLayout →
 * proseMirrorToMdast → serializeDocument`. ADR-002 lets that first save
 * normalise formatting once, and ADR-003 (requirement 5) names the one
 * normalisation an author should see: soft wraps collapse to spaces. So the
 * first save must equal the document with its soft wraps collapsed — and,
 * with them, the two normalisations `parseDocument` makes before anything
 * else (README, "Fidelity levels"): line endings become `\n`, and the blank
 * lines that end a file become its one final newline.
 *
 * Everything else a save used to change has been made to round-trip
 * (`pipeline/source-form.ts`, `pipeline/github-alert.ts`, and the prose
 * escaping in `pipeline/to-markdown-extensions.ts`). What still cannot is named
 * below, with the reason ADR-002 allows it.
 *
 * The corpus always runs. Set `QUILL_REAL_DOCS` to one or more directories
 * (separated as `PATH` is) to run every Markdown file under them as well, the
 * way the research ran the lockstay `docs/`: each document that does not come
 * back is then named with its first differing line, and the invariants that
 * must hold for every document — the meaning kept, a second save changing
 * nothing, a one-word edit changing one line — are asserted for all of them.
 */

const CORPUS = fileURLToPath(new URL('../../corpus/', import.meta.url))

interface Document {
  readonly name: string
  readonly markdown: string
}

function markdownUnder(directory: string): Document[] {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.md'))
    .toSorted()
    .map((file) => ({ name: file, markdown: readFileSync(join(directory, file), 'utf8') }))
}

/** The first save from the editor, as the editor makes it. */
function firstSave(markdown: string): string {
  const parsed = parseDocument(markdown)
  const { doc } = mdastToProseMirror(parsed.ast, { softBreaks: 'collapse' })
  return serializeDocument({
    frontMatter: parsed.frontMatter,
    ast: proseMirrorToMdast(wrapLayout(liftLayout(doc))).tree,
  })
}

/** A save after an edit to the first character of the middle top-level paragraph. */
function editedSave(markdown: string): string {
  const parsed = parseDocument(markdown)
  const lifted = liftLayout(mdastToProseMirror(parsed.ast, { softBreaks: 'collapse' }).doc)
  const paragraphs: number[] = []
  lifted.forEach((node: PMNode, _offset: number, index: number) => {
    if (node.type.name === 'paragraph' && node.textContent.length > 3) paragraphs.push(index)
  })
  const index = paragraphs[Math.floor(paragraphs.length / 2)]
  const edited = index === undefined ? lifted : withFirstCharacter(lifted, index)
  return serializeDocument({
    frontMatter: parsed.frontMatter,
    ast: proseMirrorToMdast(wrapLayout(edited)).tree,
  })
}

/** The document with the first character of its `index`th block, a paragraph, replaced by `Z`. */
function withFirstCharacter(doc: PMNode, index: number): PMNode {
  const paragraph = doc.child(index)
  const first = paragraph.firstChild
  if (first?.isText !== true) return doc
  const replaced = paragraph.copy(
    paragraph.content.replaceChild(0, schema.text(`Z${first.textContent.slice(1)}`, first.marks)),
  )
  return doc.copy(doc.content.replaceChild(index, replaced))
}

/**
 * The document with its soft wraps collapsed, worked out from the source rather
 * than through the code under test: inside each paragraph, heading and table
 * cell, a line ending and the indentation and quote markers that continue the
 * line become one space — except inside a hard break or raw HTML, and after a
 * GitHub alert's marker, whose line ending is not a soft wrap.
 */
function withSoftWrapsCollapsed(markdown: string): string {
  const source = markdown.replace(/\r\n?/g, '\n').replace(/^﻿/, '').replace(/\n+$/, '\n')
  const containers: [number, number][] = []
  const kept: [number, number][] = []
  visit(parseMarkdown(source), (node) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) return
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'tableCell') {
      containers.push([start, end])
    }
    if (node.type === 'break' || node.type === 'html') kept.push([start, end])
  })
  const isKept = (at: number): boolean => kept.some(([start, end]) => at >= start && at < end)
  let collapsed = source
  for (const [start, end] of containers.toSorted((a, b) => b[0] - a[0])) {
    const inside = collapsed
      .slice(start, end)
      .replace(/[ \t]*\n[ \t>]*/g, (wrap: string, at: number) => {
        if (isKept(start + at + wrap.indexOf('\n'))) return wrap
        const line = `${collapsed.slice(start, start + at)}\n`
        return MARKER_LINE.test(line) ? wrap.replace(/^[ \t]+/, '') : ' '
      })
    collapsed = collapsed.slice(0, start) + inside + collapsed.slice(end)
  }
  return collapsed
}

/** A callout's first line: a marker, the title after it if there is one, and its line break. */
const MARKER_LINE = /^\[![A-Za-z][\w-]*\](?:[^\S\n].*)?\n$/u

/** Byte offsets are not semantics, nor is how a node was spelled. */
function semantics(tree: Root): string {
  return JSON.stringify(tree, (key, value: unknown) =>
    key === 'position' || key === 'sourceForm' || value === null ? undefined : value,
  )
}

function changedLines(before: string, after: string): number {
  const a = before.split('\n')
  const b = after.split('\n')
  const differing = a.filter((line, index) => line !== b[index]).length
  return differing + Math.abs(a.length - b.length)
}

/** The first line a save changed, for naming a document that did not come back. */
function firstDifference(expected: string, actual: string): string {
  const a = expected.split('\n')
  const b = actual.split('\n')
  const index = a.findIndex((line, at) => line !== b[at])
  return `line ${index + 1}: ${JSON.stringify(a[index])} became ${JSON.stringify(b[index])}`
}

/**
 * The corpus documents a first save cannot leave as they were, each for a
 * reason ADR-002 allows: they are the hazards the corpus keeps on purpose.
 *
 * - `16-inline-edge-cases.md`: character references (`&copy;`) are kept as the
 *   characters they stand for, a backslash before a character that needs none
 *   (`1\.`, `a\\b`) is not kept, and a code span's padding is the writer's own.
 *   mdast records none of these.
 * - `19-escaping-hazards.md`: the same needless backslashes (`2026\.`,
 *   `\#hashtag`), and a container directive nested in one with an equal fence,
 *   which the writer gives a longer fence so that it nests.
 */
const NORMALISED = ['16-inline-edge-cases.md', '19-escaping-hazards.md']

const corpus = markdownUnder(CORPUS)

describe('the first save of a real document', () => {
  it('reads the corpus', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(26)
  })

  it('leaves every corpus document as it was, but for its soft wraps', () => {
    const changed = corpus
      .filter(({ markdown }) => firstSave(markdown) !== withSoftWrapsCollapsed(markdown))
      .map(({ name }) => name)

    expect(changed).toEqual(NORMALISED)
  })

  it('keeps the meaning of every corpus document', () => {
    const changed = corpus.filter(
      ({ markdown }) =>
        semantics(parseMarkdown(firstSave(markdown))) !==
        semantics(parseMarkdown(withSoftWrapsCollapsed(markdown))),
    )

    expect(changed.map(({ name }) => name)).toEqual([])
  })

  it('changes nothing on a second save', () => {
    const changed = corpus.filter(({ markdown }) => {
      const once = firstSave(markdown)
      return firstSave(once) !== once
    })

    expect(changed.map(({ name }) => name)).toEqual([])
  })

  it('changes one line for a one-word edit', () => {
    const spread = corpus.filter(({ markdown }) => {
      const once = firstSave(markdown)
      return changedLines(once, editedSave(once)) > 1
    })

    expect(spread.map(({ name }) => name)).toEqual([])
  })
})

const external = (process.env['QUILL_REAL_DOCS'] ?? '')
  .split(delimiter)
  .filter((directory) => directory.length > 0)
  .flatMap((directory) => markdownUnder(directory))

/** Hundreds of documents take a while: the research's 212 take about half a minute. */
const EXTERNAL_TIMEOUT = 600_000

describe.skipIf(external.length === 0)(
  'the first save of the documents in QUILL_REAL_DOCS',
  { timeout: EXTERNAL_TIMEOUT },
  () => {
    it('names each document that does not come back as it was, but for its soft wraps', () => {
      const changed = external.flatMap(({ name, markdown }) => {
        const expected = withSoftWrapsCollapsed(markdown)
        const actual = firstSave(markdown)
        return actual === expected ? [] : [`${name} ${firstDifference(expected, actual)}`]
      })
      const kept = external.length - changed.length

      // A report for whoever ran it rather than an assertion: what these
      // documents hold is not known here.
      process.stdout.write(
        `${kept} of ${external.length} come back as they were.\n${changed.join('\n')}\n`,
      )
      expect(kept).toBeGreaterThan(0)
    })

    it('keeps the meaning of every document, and a second save changes nothing', () => {
      const broken = external.filter(({ markdown }) => {
        const once = firstSave(markdown)
        const meaning = semantics(parseMarkdown(withSoftWrapsCollapsed(markdown)))
        return semantics(parseMarkdown(once)) !== meaning || firstSave(once) !== once
      })

      expect(broken.map(({ name }) => name)).toEqual([])
    })
  },
)
