import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import * as fc from 'fast-check'
import type { Nodes, Root, RootContent } from 'mdast'
import { toString } from 'mdast-util-to-string'
import { describe, expect, it } from 'vitest'

import { stripPresenterNotes } from '../directives/strip-presenter-notes.ts'
import { parseDocument } from '../pipeline/parse-document.ts'
import { stringifyMdast } from '../pipeline/processor.ts'
import { compareDocuments, compareProperties } from './compare.ts'

function tree(markdown: string): Root {
  return parseDocument(markdown).ast
}

function compare(before: string, after: string) {
  return compareDocuments(tree(before), tree(after))
}

function properties(node: RootContent): Record<string, unknown> {
  return node.data?.hProperties ?? {}
}

/**
 * One side of a comparison tree, as text: the newer side drops removals and
 * the older halves of before-and-after pairs; the older side drops additions
 * and the newer halves. Moved blocks are on both sides, where they now are.
 */
function side(root: Root, which: 'before' | 'after'): string {
  const dropped = which === 'after' ? 'removed' : 'added'
  const droppedSide = which === 'after' ? 'before' : 'after'
  const keep = (node: Nodes): boolean => {
    if (node.type === (which === 'after' ? 'diffDeletion' : 'diffInsertion')) return false
    const props = 'data' in node ? (node.data?.hProperties ?? {}) : {}
    if (props['data-change'] === dropped) return false
    return props['data-side'] !== droppedSide
  }
  const strip = (node: Nodes): string => {
    if (node.type === 'diffCode') {
      return node.lines
        .filter((line) => line.change !== dropped)
        .map((line) =>
          line.segments
            .filter((segment) => segment.change !== dropped)
            .map((segment) => segment.text)
            .join(''),
        )
        .join('\n')
    }
    if ('children' in node) {
      const children: Nodes[] = node.children
      return children
        .filter(keep)
        .map(strip)
        .join(node.type === 'root' ? '\n' : '')
    }
    return toString(node)
  }
  return strip(root)
}

function plain(markdown: string): string {
  return stripPresenterNotes(tree(markdown))
    .children.filter((node) => node.type !== 'yaml')
    .map((node) => toString(node))
    .join('\n')
}

describe('compareDocuments', () => {
  it('finds no changes between equal documents', () => {
    const result = compare('# Title\n\nBody.\n', '# Title\n\nBody.\n')
    expect(result.changes).toEqual([])
    expect(result.tree.children.map((node) => properties(node)['data-change'])).toEqual([
      undefined,
      undefined,
    ])
  })

  it('marks words inside an edited paragraph and counts them', () => {
    const result = compare('Deploy on Monday.\n', 'Deploy on Tuesday after review.\n')
    expect(result.changes).toMatchObject([
      { id: 'c1', change: 'changed', block: 'paragraph', wordsAdded: 3, wordsRemoved: 1, index: 0 },
    ])
    const [paragraph] = result.tree.children
    expect(paragraph?.type).toBe('paragraph')
    if (paragraph?.type !== 'paragraph') return
    expect(paragraph.children.map((node) => node.type)).toEqual([
      'text',
      'diffDeletion',
      'diffInsertion',
      'text',
    ])
    expect(properties(paragraph)).toMatchObject({
      'data-change': 'changed',
      'data-change-id': 'c1',
    })
  })

  it('marks whole blocks added and removed, wrapping their words', () => {
    const result = compare('Keep.\n\nGone now.\n', 'Keep.\n\nBrand new words.\n')
    expect(result.changes.map((change) => [change.change, change.excerpt])).toEqual([
      ['removed', 'Gone now.'],
      ['added', 'Brand new words.'],
    ])
    const [, removed, added] = result.tree.children
    expect(removed?.type === 'paragraph' && removed.children[0]?.type).toBe('diffDeletion')
    expect(added?.type === 'paragraph' && added.children[0]?.type).toBe('diffInsertion')
  })

  it('compares a table by row and by cell', () => {
    const result = compare(
      '| Name | Port |\n| --- | --- |\n| api | 3000 |\n| web | 5173 |\n',
      '| Name | Port |\n| --- | --- |\n| api | 3001 |\n| web | 5173 |\n| worker | none |\n',
    )
    expect(result.changes).toMatchObject([{ change: 'changed', block: 'table' }])
    const [table] = result.tree.children
    if (table?.type !== 'table') throw new Error('expected a table')
    expect(table.children.map((row) => row.data?.hProperties?.['data-change'])).toEqual([
      undefined,
      'changed',
      undefined,
      'added',
    ])
    const changedPort = table.children[1]?.children[1]
    expect(changedPort?.children.map((node) => node.type)).toEqual([
      'diffDeletion',
      'diffInsertion',
    ])
  })

  it('compares a list by item', () => {
    const result = compare('- one\n- two\n- three\n', '- one\n- two, edited\n- three\n- four\n')
    const [list] = result.tree.children
    if (list?.type !== 'list') throw new Error('expected a list')
    expect(list.children.map((item) => item.data?.hProperties?.['data-change'])).toEqual([
      undefined,
      'changed',
      undefined,
      'added',
    ])
  })

  it('compares a code block by line, with the words of a changed line', () => {
    const result = compare(
      '```ts\nconst a = 1\nconst b = 2\n```\n',
      '```ts\nconst a = 1\nconst b = 3\n```\n',
    )
    const [code] = result.tree.children
    expect(code?.type).toBe('diffCode')
    if (code?.type !== 'diffCode') return
    expect(code.lines.map((line) => line.change)).toEqual(['equal', 'removed', 'added'])
    expect(code.lines[2]?.segments).toEqual([
      { change: 'equal', text: 'const b = ' },
      { change: 'added', text: '3' },
    ])
  })

  it('shows an image and a diagram before and after', () => {
    const result = compare(
      '![Plan](/a.png)\n\n```mermaid\ngraph TD; A-->B\n```\n',
      '![Plan](/b.png)\n\n```mermaid\ngraph TD; A-->C\n```\n',
    )
    expect(result.changes.map((change) => change.block)).toEqual(['image', 'diagram'])
    expect(result.tree.children.map((node) => properties(node)['data-side'])).toEqual([
      'before',
      'after',
      'before',
      'after',
    ])
  })

  it('shows a moved block once, where it went', () => {
    const result = compare(
      'Intro.\n\nA paragraph that moves down.\n\nMiddle.\n\nEnd.\n',
      'Intro.\n\nMiddle.\n\nEnd.\n\nA paragraph that moves down.\n',
    )
    expect(result.changes).toMatchObject([
      { change: 'moved', excerpt: 'A paragraph that moves down.' },
    ])
    expect(result.tree.children).toHaveLength(4)
  })

  it('compares inside a callout', () => {
    const result = compare(':::note\nOld advice.\n:::\n', ':::note\nNew advice.\n:::\n')
    expect(result.changes).toMatchObject([{ change: 'changed', block: 'callout' }])
  })

  it('leaves presenter notes out, since readers never see them', () => {
    const result = compare(
      'Body.\n\n:::notes\nSay hello.\n:::\n',
      'Body.\n\n:::notes\nSay goodbye.\n:::\n',
    )
    expect(result.changes).toEqual([])
  })

  it('reads as the newer document, and as the older one, on either side', () => {
    const before =
      '# Plan\n\nWe ship *on Monday*.\n\n- alpha\n- beta\n\n| a | b |\n| - | - |\n| 1 | 2 |\n'
    const after =
      '# Plan, revised\n\nWe ship *on Tuesday* after review.\n\n- alpha\n- gamma\n- beta\n\n| a | b |\n| - | - |\n| 1 | 3 |\n'
    const result = compare(before, after)
    expect(side(result.tree, 'after')).toBe(plain(after))
    expect(side(result.tree, 'before')).toBe(plain(before))
  })
})

describe('the corpus, compared', () => {
  const corpus = fileURLToPath(new URL('../../corpus/', import.meta.url))
  const files = readdirSync(corpus)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({ name, markdown: readFileSync(`${corpus}${name}`, 'utf8') }))

  it.each(files)('$name has no changes against itself', ({ markdown }) => {
    expect(compare(markdown, markdown).changes).toEqual([])
  })

  it('reads as both sides for every corpus file under random edits', () => {
    const edit = fc.record({
      file: fc.integer({ min: 0, max: files.length - 1 }),
      drop: fc.nat(),
      insertAt: fc.nat(),
      reword: fc.nat(),
    })
    fc.assert(
      fc.property(edit, ({ file, drop, insertAt, reword }) => {
        const source = files[file]?.markdown ?? ''
        const parsed = tree(source)
        const blocks = parsed.children.filter((node) => node.type !== 'yaml')
        if (blocks.length === 0) return
        const changed = blocks.filter((_, index) => index !== drop % blocks.length)
        changed.splice(insertAt % (changed.length + 1), 0, {
          type: 'paragraph',
          children: [{ type: 'text', value: 'An inserted paragraph for the comparison.' }],
        })
        const target = changed[reword % changed.length]
        if (target?.type === 'paragraph') {
          target.children = [...target.children, { type: 'text', value: ' Reworded.' }]
        }
        const after = stringifyMdast({ type: 'root', children: changed })
        const result = compare(source, after)
        expect(side(result.tree, 'after')).toBe(plain(after))
        expect(side(result.tree, 'before')).toBe(plain(source))
      }),
      { numRuns: 60 },
    )
  })
})

describe('compareProperties', () => {
  it('lists the fields that changed, never the document id', () => {
    expect(
      compareProperties(
        { id: 'a', title: 'Old', tags: ['x'], owner: 'sam' },
        { id: 'a', title: 'New', tags: ['x', 'y'], status: 'draft', owner: 'sam' },
      ),
    ).toEqual([
      { name: 'title', before: 'Old', after: 'New' },
      { name: 'tags', before: 'x', after: 'x, y' },
      { name: 'status', after: 'draft' },
    ])
  })
})
