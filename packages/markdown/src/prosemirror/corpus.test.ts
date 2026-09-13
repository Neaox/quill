import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Root } from 'mdast'

import { parseDocument } from '../pipeline/parse-document.ts'
import { parseMarkdown } from '../pipeline/processor.ts'
import { serializeDocument } from '../pipeline/serialize-document.ts'
import { renderHtml } from '../render/html.ts'
import { mdastToProseMirror } from './from-mdast.ts'
import { liftLayout, wrapLayout } from './layout.ts'
import { proseMirrorToMdast } from './to-mdast.ts'

/**
 * The fidelity harness of research R3, as a test.
 *
 * For each document:
 *
 *   md1 = serialise(parse(md0))                      what remark does on its own
 *   md2 = serialise(pm(parse(md0)))                  the full editor round trip
 *   md3 = a second pass over md2
 *
 *   byte  md2 === md0   nothing changed at all
 *   conv  md2 === md1   the ProseMirror hop added no loss of its own, so every
 *                       difference from md0 is remark's canonical normalisation
 *   sem   parse(md2) deep-equals parse(md0)
 *   idem  md3 === md2   ADR-002's determinism requirement
 *
 * `conv` and `idem` must hold for every document. `byte` and `sem` are reported,
 * and each failure is named with its cause rather than defined away.
 */

const CORPUS = fileURLToPath(new URL('../../corpus/', import.meta.url))

type LayoutMode = 'wrapper' | 'attr'

/** Byte offsets are not semantics, and an absent field equals an explicitly empty one. */
function semantics(tree: Root): string {
  return JSON.stringify(tree, (key, value: unknown) =>
    key === 'position' || value === null ? undefined : value,
  )
}

function roundTrip(markdown: string, mode: LayoutMode): string {
  const parsed = parseDocument(markdown)
  const { doc } = mdastToProseMirror(parsed.ast)
  const edited = mode === 'attr' ? wrapLayout(liftLayout(doc)) : doc
  return serializeDocument({
    frontMatter: parsed.frontMatter,
    ast: proseMirrorToMdast(edited).tree,
  })
}

interface Row {
  readonly file: string
  readonly byte: boolean
  readonly conv: boolean
  readonly sem: boolean
  readonly idem: boolean
}

function measure(file: string, mode: LayoutMode): Row {
  // Deliberately not normalised here. A corpus file is checked in with `\n`
  // (`.gitattributes`), but pre-normalising in the harness is what hid CRLF
  // handling from every one of these measurements, and `parseDocument` is now
  // where line endings are settled — so the harness reads the bytes on disk and
  // the CRLF case below asserts the normalisation explicitly.
  const source = readFileSync(`${CORPUS}${file}`, 'utf8')
  const canonical = serializeDocument(parseDocument(source))
  const once = roundTrip(source, mode)
  const twice = roundTrip(once, mode)
  return {
    file,
    byte: once === source,
    conv: once === canonical,
    sem: semantics(parseMarkdown(source)) === semantics(parseMarkdown(once)),
    idem: twice === once,
  }
}

const FILES = readdirSync(CORPUS)
  .filter((file) => file.endsWith('.md'))
  .toSorted()

/**
 * The one document whose mdast differs after a round trip: `mdast-util-gfm-table`
 * pads a row that has fewer cells than the header, so re-parsing yields an extra
 * empty cell. GFM renders a missing trailing cell as empty, so the rendered table
 * is identical, but the tree is not and the harness says so.
 */
const KNOWN_SEMANTIC_DIFFERENCE = '02-gfm-tables.md'

/**
 * The documents whose canonical form is the form their author already wrote.
 * Everything absent from this list differs only by the normalisations the README
 * names under semantic-preserving fidelity.
 */
const BYTE_IDENTICAL = [
  '01-commonmark-basics.md',
  '03-nested-lists.md',
  '04-task-lists.md',
  '05-code-in-lists.md',
  '06-code-fences.md',
  '07-reference-links.md',
  '08-html-blocks.md',
  '09-frontmatter-unknown.md',
  '15-changelog.md',
]

function frontMatterOf(markdown: string): string {
  return markdown.split('---\n')[1] ?? ''
}

describe('the fidelity corpus', () => {
  it('has the documents the research measured', () => {
    expect(FILES).toHaveLength(19)
  })

  for (const mode of ['wrapper', 'attr'] as const) {
    describe(`with layout as a ${mode}`, () => {
      const rows = FILES.map((file) => measure(file, mode))

      it('is converter-lossless for every document', () => {
        expect(rows.filter((row) => !row.conv)).toEqual([])
      })

      it('is idempotent for every document', () => {
        expect(rows.filter((row) => !row.idem)).toEqual([])
      })

      it('is semantically identical for every document but the one that cannot be', () => {
        expect(rows.filter((row) => !row.sem).map((row) => row.file)).toEqual([
          KNOWN_SEMANTIC_DIFFERENCE,
        ])
      })

      it('leaves exactly these documents byte-identical', () => {
        // Named, not counted: a count stays green when one document starts
        // round-tripping byte for byte and another stops, which is the pair of
        // changes most worth hearing about.
        expect(rows.filter((row) => row.byte).map((row) => row.file)).toEqual(BYTE_IDENTICAL)
      })
    })
  }

  it('normalises a CRLF document once, and changes nothing else about it', () => {
    // An HTML parser collapses `\r\n` while building a text node, so a document
    // that keeps its `\r` through the pipeline produces token offsets (ADR-030)
    // that are wrong by one per line. Nothing here strips the `\r` first: that
    // is the point.
    const lf = readFileSync(`${CORPUS}06-code-fences.md`, 'utf8')
    const crlf = lf.replaceAll('\n', '\r\n')

    expect(crlf).toContain('\r\n')
    expect(serializeDocument(parseDocument(crlf))).toBe(serializeDocument(parseDocument(lf)))
    expect(semantics(parseMarkdown(crlf))).toBe(semantics(parseMarkdown(lf)))
    expect(renderHtml(parseDocument(crlf).ast)).not.toContain('\r')
    expect(roundTrip(crlf, 'wrapper')).toBe(roundTrip(lf, 'wrapper'))
  })

  it('drops a byte-order mark and keeps the document otherwise unchanged', () => {
    const lf = readFileSync(`${CORPUS}01-commonmark-basics.md`, 'utf8')

    expect(serializeDocument(parseDocument(`﻿${lf}`))).toBe(serializeDocument(parseDocument(lf)))
  })

  it('brings unknown front matter back byte for byte', () => {
    const source = readFileSync(`${CORPUS}09-frontmatter-unknown.md`, 'utf8')
    const output = roundTrip(source, 'wrapper')
    expect(frontMatterOf(output)).toBe(frontMatterOf(source))
    expect(output).toContain('# a comment inside the front matter')
    expect(output).toContain('? complex key')
    expect(output).toContain('quotedString: "keep   my    spacing"')
  })

  it('brings unknown directives back unchanged', () => {
    const source = readFileSync(`${CORPUS}12-unknown-directive.md`, 'utf8')
    const output = roundTrip(source, 'wrapper')

    for (const name of ['timeline', 'experiment', 'future-embed', 'unknown-inline', 'panel']) {
      expect(output).toContain(name)
    }
    expect(output).toContain('A/B test: sidebar width')
  })

  it('produces a document that passes Node.check() for every corpus file', () => {
    for (const file of FILES) {
      const source = readFileSync(`${CORPUS}${file}`, 'utf8')
      const { doc, warnings } = mdastToProseMirror(parseDocument(source).ast)

      expect(warnings).toEqual([])
      expect(() => doc.check()).not.toThrow()
    }
  })
})
