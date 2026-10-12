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

/**
 * Byte offsets are not semantics, nor is how a node was spelled
 * (`pipeline/source-form.ts`), and an absent field equals an explicitly empty one.
 */
function semantics(tree: Root): string {
  return JSON.stringify(tree, (key, value: unknown) =>
    key === 'position' || key === 'sourceForm' || value === null ? undefined : value,
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
 * The documents that are not written back byte for byte, because they hold
 * what mdast cannot keep: character references, backslashes the author wrote
 * where none was needed, padding inside a code span, and a container directive
 * nested inside one with an equal fence. Every other document is written back
 * as it was read (`pipeline/source-form.ts`), its short table row included.
 * Named, so a document that starts or stops round-tripping is heard about.
 */
const NOT_BYTE_IDENTICAL = ['16-inline-edge-cases.md', '19-escaping-hazards.md']

function frontMatterOf(markdown: string): string {
  return markdown.split('---\n')[1] ?? ''
}

describe('the fidelity corpus', () => {
  it('has the documents the research measured', () => {
    expect(FILES).toHaveLength(27)
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

      it('is semantically identical for every document', () => {
        expect(rows.filter((row) => !row.sem).map((row) => row.file)).toEqual([])
      })

      it('leaves every document byte-identical but those that cannot be', () => {
        // Named, not counted: a count stays green when one document starts
        // round-tripping byte for byte and another stops, which is the pair of
        // changes most worth hearing about.
        expect(rows.filter((row) => !row.byte).map((row) => row.file)).toEqual(NOT_BYTE_IDENTICAL)
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

  it('brings table options back, with the attributes it cannot read (ADR-040)', () => {
    const output = roundTrip(readFileSync(`${CORPUS}23-tables.md`, 'utf8'), 'wrapper')

    expect(output).toContain(
      ':::table{width="70%" columns="2fr 3fr 1fr" freeze="header,first-column" responsive="stack" sort="off"}',
    )
    expect(output).toContain(':::table{width="huge" caption="Kept as written" future}')
    // A table headed by its rows alone keeps its delimiter row under the
    // first row of data, byte for byte.
    expect(output).toContain(
      ':::table[Specification]{headers=row}\n| Runtime  | Node 24       |\n| -------- | ------------- |\n',
    )
    expect(output).toContain(
      ':::table[Latency budgets by region]{headers=both footer=1 freeze=header,footer caption=bottom}',
    )
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
