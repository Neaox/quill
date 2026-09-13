import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDocument, serializeDocument } from '@quill/markdown'

import { documentFromMdast, documentToMdast } from './ast.ts'

/**
 * The fidelity corpus of research R3, run through the editor's schema rather
 * than the converter's.
 *
 * The editor adds a DOM and table editing to the published extension list. This
 * test is the guard that it adds nothing else: a document loaded into the editor
 * and saved again without being edited must produce exactly the bytes the
 * Markdown package produces on its own, for every document in the corpus.
 */

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), '../../../markdown/corpus')

const FILES = readdirSync(CORPUS)
  .filter((file) => file.endsWith('.md'))
  .toSorted()

function read(file: string): string {
  return readFileSync(join(CORPUS, file), 'utf8').replaceAll('\r\n', '\n')
}

function roundTrip(markdown: string): string {
  const parsed = parseDocument(markdown)
  const { doc } = documentFromMdast(parsed.ast)
  return serializeDocument({ frontMatter: parsed.frontMatter, ast: documentToMdast(doc).tree })
}

describe('a document through the live editor schema', () => {
  it('finds the corpus the research measured', () => {
    expect(FILES).toHaveLength(19)
  })

  it('serialises to the canonical form for every corpus document', () => {
    const different = FILES.filter((file) => {
      const source = read(file)
      return roundTrip(source) !== serializeDocument(parseDocument(source))
    })
    expect(different).toEqual([])
  })

  it('reports no conversion warning for any corpus document', () => {
    const noisy = FILES.filter((file) => documentFromMdast(parseDocument(read(file)).ast).warnings)
      .map((file) => ({
        file,
        warnings: documentFromMdast(parseDocument(read(file)).ast).warnings,
      }))
      .filter((row) => row.warnings.length > 0)
    expect(noisy).toEqual([])
  })

  it('builds a document that passes the schema check for every corpus document', () => {
    for (const file of FILES) {
      const { doc } = documentFromMdast(parseDocument(read(file)).ast)
      expect(() => doc.check()).not.toThrow()
    }
  })

  it('collapses soft wraps only when asked to', () => {
    const wrapped = 'A paragraph broken\nacross two source lines.\n'
    const preserved = documentFromMdast(parseDocument(wrapped).ast)
    const collapsed = documentFromMdast(parseDocument(wrapped).ast, { softBreaks: 'collapse' })
    expect(preserved.doc.textContent).toContain('\n')
    expect(collapsed.doc.textContent).not.toContain('\n')
  })
})
