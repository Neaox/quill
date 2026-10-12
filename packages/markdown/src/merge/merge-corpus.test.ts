import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Paragraph, Root, RootContent } from 'mdast'

import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import { mergeDocuments } from './merge-documents.ts'
import { mergeMarkdown } from './merge-markdown.ts'

/**
 * The fidelity corpus as merge fixtures: real documents, with front matter,
 * directives, tables, code groups and the escaping hazards, edited by two
 * people at once. A merge must give both edits and move no other byte.
 */

const CORPUS = fileURLToPath(new URL('../../corpus/', import.meta.url))
const FILES = readdirSync(CORPUS)
  .filter((file) => file.endsWith('.md'))
  .toSorted()

/** The documents the serialiser does not write back byte for byte (`corpus.test.ts`). */
const NOT_BYTE_IDENTICAL = new Set(['16-inline-edge-cases.md', '19-escaping-hazards.md'])

const read = (file: string): string => readFileSync(`${CORPUS}${file}`, 'utf8')

const paragraph = (text: string): Paragraph => ({
  type: 'paragraph',
  children: [{ type: 'text', value: text }],
})

function withChildren(root: Root, children: readonly RootContent[]): Root {
  return { ...root, children: [...children] }
}

/** The longest paragraph with at least four words, which both sides will edit. */
function longestParagraph(root: Root): { index: number; text: string } | undefined {
  let found: { index: number; text: string } | undefined
  for (const [index, block] of root.children.entries()) {
    if (block.type !== 'paragraph' || block.children.length !== 1) continue
    const [only] = block.children
    if (only?.type !== 'text' || only.value.split(' ').length < 4) continue
    if (found === undefined || only.value.length > found.text.length)
      found = { index, text: only.value }
  }
  return found
}

describe.each(FILES)('merging %s', (file) => {
  const source = read(file)

  it('adds one side’s new block at the top and the other’s at the end, moving nothing else', () => {
    const base = parseMarkdown(source)
    const top = base.children[0]?.type === 'yaml' ? 1 : 0
    const mine = withChildren(base, base.children.toSpliced(top, 0, paragraph('Mine added this.')))
    const theirs = withChildren(base, [...base.children, paragraph('Theirs added this.')])
    const result = mergeDocuments(parseMarkdown(source), mine, theirs)
    expect(result.conflicts).toEqual([])
    const written = stringifyMdast(result.merged)
    const canonical = stringifyMdast(parseMarkdown(source))
    expect(written).toContain('Mine added this.')
    expect(written).toContain('Theirs added this.')
    expect(written.replace('Mine added this.\n\n', '').replace('\nTheirs added this.\n', '')).toBe(
      NOT_BYTE_IDENTICAL.has(file) ? canonical : source,
    )
  })

  it('merges two people’s edits to different words of one paragraph', () => {
    const base = parseMarkdown(source)
    const target = longestParagraph(base)
    if (target === undefined) return
    const words = target.text.split(' ')
    const edited = (replace: (all: string[]) => string[]) =>
      withChildren(
        base,
        base.children.toSpliced(target.index, 1, paragraph(replace([...words]).join(' '))),
      )
    const mine = edited((all) => ['Mine', ...all.slice(1)])
    const theirs = edited((all) => [...all.slice(0, -1), 'theirs.'])
    const result = mergeDocuments(parseMarkdown(source), mine, theirs)
    expect(result.conflicts).toEqual([])
    const merged = result.merged.children[target.index]
    expect(merged?.type === 'paragraph' && merged.children[0]).toMatchObject({
      value: ['Mine', ...words.slice(1, -1), 'theirs.'].join(' '),
    })
  })

  it('is the identity in text when one side changed nothing', () => {
    const edited = `${source}\nAn edit.\n`
    expect(mergeMarkdown(source, source, edited)).toEqual({ clean: true, markdown: edited })
    expect(mergeMarkdown(source, edited, source)).toEqual({ clean: true, markdown: edited })
  })
})
