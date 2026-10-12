import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { Root } from 'mdast'

import { mdastToProseMirror } from '../prosemirror/from-mdast.ts'
import { proseMirrorToMdast } from '../prosemirror/to-mdast.ts'
import { parseDocument } from './parse-document.ts'
import { parseMarkdown, stringifyMdast } from './processor.ts'
import { serializeDocument } from './serialize-document.ts'

/**
 * A colon is escaped only where it would start a directive when read back
 * (ADR-002, ADR-038): saving a document must not rewrite `:smile:` as
 * `\:smile:`, nor `a:b:c` as `a\:b:c`.
 */

/** Byte offsets are not semantics. */
function semantics(tree: Root): string {
  return JSON.stringify(tree, (key, value: unknown) =>
    key === 'position' || value === null ? undefined : value,
  )
}

/** Through the editor's schema and back, as a save does. */
function saved(markdown: string): string {
  const parsed = parseDocument(markdown)
  const { doc } = mdastToProseMirror(parsed.ast)
  return serializeDocument({ frontMatter: parsed.frontMatter, ast: proseMirrorToMdast(doc).tree })
}

const CORPUS = fileURLToPath(new URL('../../corpus/', import.meta.url))

/** Every prose line of the corpus with a colon or an address in it: the lines these rules can touch. */
const CORPUS_LINES = readdirSync(CORPUS)
  .filter((file) => file.endsWith('.md'))
  .flatMap((file) => readFileSync(`${CORPUS}${file}`, 'utf8').split('\n'))
  .filter((line) => /:|www\.|@/u.test(line) && /^[\p{L}\p{N}:*_`[(<]/u.test(line))

const BYTE_FOR_BYTE = [
  ':smile:',
  ':+1:',
  ':acme:',
  'Thumbs :+1: up, then :smile: last :tada:',
  'a:b:c',
  '10:30:00',
  'status:ok',
  '<https://x.y/a:b>',
  'A sentence that ends in a colon:',
  ': a line that starts with a colon',
  ':smile: next to :ok[Built]',
  ':acme: on :acme[Acme]{x="1"}',
]

describe('colons on a save', () => {
  it.each(BYTE_FOR_BYTE)('keep %s byte for byte', (line) => {
    const source = `${line}\n`
    expect(stringifyMdast(parseMarkdown(source))).toBe(source)
    expect(saved(source)).toBe(source)
  })

  it('read back as the tree they were written from, for every corpus line', () => {
    const changed = CORPUS_LINES.filter((line) => {
      const tree = parseMarkdown(`${line}\n`)
      return semantics(parseMarkdown(stringifyMdast(tree))) !== semantics(tree)
    })
    expect(CORPUS_LINES.length).toBeGreaterThan(50)
    expect(changed).toEqual([])
  })

  it('are still escaped wherever one would start a directive', () => {
    // Each of these text nodes, written bare, would read back as a directive.
    for (const value of ['a:b', ':smile:c', 'a:9front', ':smile:x[y]', 'x :a', 'a:b-c']) {
      const tree: Root = {
        type: 'root',
        children: [{ type: 'paragraph', children: [{ type: 'text', value }] }],
      }
      expect(semantics(parseMarkdown(stringifyMdast(tree)))).toBe(semantics(tree))
    }
  })
})
