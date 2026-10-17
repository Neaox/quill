import type { Nodes, Root, RootContent, Table } from 'mdast'
import { describe, expect, it } from 'vitest'

import { parseDocument } from '../pipeline/parse-document.ts'
import { compareDocuments, compareProperties } from './compare.ts'

const tree = (markdown: string): Root => parseDocument(markdown).ast

const compare = (before: string, after: string) => compareDocuments(tree(before), tree(after))

/** The change each child of a container carries, in order: what the comparison drew beside it. */
function marks(node: RootContent | undefined): (string | undefined)[] {
  if (node === undefined || !('children' in node)) return []
  const children: Nodes[] = node.children
  return children.map((child) => {
    const mark = 'data' in child ? child.data?.hProperties?.['data-change'] : undefined
    return typeof mark === 'string' ? mark : undefined
  })
}

const sides = (result: ReturnType<typeof compare>) =>
  result.tree.children.map((node) => node.data?.hProperties?.['data-side'])

const MOVING = 'A paragraph that moves down.'

const rows = (...names: string[]): string =>
  `| Name | Port |\n| --- | --- |\n${names.map((name) => `| ${name} | 1 |`).join('\n')}\n`

const emptyTable = (align: Table['align']): RootContent => ({ type: 'table', align, children: [] })

const bareDirective = (value: string): RootContent => ({
  type: 'containerDirective',
  name: 'columns',
  children: [{ type: 'paragraph', children: [{ type: 'text', value }] }],
})

const paragraph = (value: string): RootContent => ({
  type: 'paragraph',
  children: [{ type: 'text', value }],
})

describe('compareProperties', () => {
  it('reads dates as days, objects as JSON, and lists item by item', () => {
    expect(
      compareProperties(
        {
          created: new Date('2026-01-02T03:04:05Z'),
          links: { a: 1 },
          nested: [['x'], 'y'],
          gaps: [],
        },
        {
          created: new Date('2026-02-03T03:04:05Z'),
          links: { a: 2 },
          nested: [['x'], 'z'],
          gaps: ['a', null],
        },
      ),
    ).toEqual([
      { name: 'created', before: '2026-01-02', after: '2026-02-03' },
      { name: 'links', before: '{"a":1}', after: '{"a":2}' },
      { name: 'nested', before: 'x, y', after: 'x, z' },
      { name: 'gaps', before: '', after: 'a, ' },
    ])
  })

  it('treats a field set to nothing as a field that is not there', () => {
    expect(compareProperties({ owner: null, status: 'draft' }, { status: undefined })).toEqual([
      { name: 'status', before: 'draft' },
    ])
  })
})

describe('comparing inside a quote', () => {
  it('marks each block the quote added, removed, changed and moved', () => {
    const result = compare(
      `> Intro.\n>\n> ${MOVING}\n>\n> Gone entirely.\n>\n> Edit me old.\n>\n> End.\n`,
      `> Intro.\n>\n> Edit me new.\n>\n> End.\n>\n> Fresh paragraph.\n>\n> ${MOVING}\n`,
    )

    expect(result.changes).toMatchObject([{ change: 'changed', block: 'quote' }])
    expect(marks(result.tree.children[0])).toEqual([
      undefined,
      'removed',
      'changed',
      undefined,
      'added',
      'moved',
    ])
  })
})

describe('comparing inside a list', () => {
  it('marks each item the list added, removed and moved', () => {
    const result = compare(
      `- Intro item.\n- ${MOVING}\n- Gone entirely.\n- Middle item.\n- End item.\n`,
      `- Intro item.\n- Middle item.\n- End item.\n- Fresh item.\n- ${MOVING}\n`,
    )

    expect(marks(result.tree.children[0])).toEqual([
      undefined,
      'removed',
      undefined,
      undefined,
      'added',
      'moved',
    ])
  })

  it('shows lists of different kinds before and after', () => {
    const result = compare('- one\n- two\n', '1. one\n2. two\n')

    expect(result.changes).toMatchObject([{ change: 'changed', block: 'list' }])
    expect(sides(result)).toEqual(['before', 'after'])
  })
})

describe('comparing inside a table', () => {
  it('marks each row the table removed and moved', () => {
    const result = compare(
      rows('alpha', 'bravo row moving', 'gone row', 'delta', 'echo'),
      rows('alpha', 'delta', 'echo', 'bravo row moving'),
    )

    expect(marks(result.tree.children[0]).slice(1)).toEqual([
      undefined,
      'removed',
      undefined,
      undefined,
      'moved',
    ])
  })

  it('shows a table with another set of columns before and after', () => {
    const result = compare(
      '| a | b |\n| - | - |\n| 1 | 2 |\n',
      '| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n',
    )

    expect(result.changes).toMatchObject([{ change: 'changed', block: 'table' }])
    expect(sides(result)).toEqual(['before', 'after'])
  })

  it('adds a row that has an empty cell', () => {
    const result = compare(
      '| a | b |\n| - | - |\n| 1 | 2 |\n',
      '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 |  |\n',
    )

    expect(result.changes).toMatchObject([{ change: 'changed', block: 'table', wordsAdded: 1 }])
  })

  it('compares a row that has more cells than the older row had', () => {
    const result = compare(
      '| a | b |\n| - | - |\n| one |\n',
      '| a | b |\n| - | - |\n| one | two |\n',
    )

    expect(result.changes).toMatchObject([{ change: 'changed', block: 'table', wordsAdded: 1 }])
  })

  it('shows two tables that have no rows before and after, since there is nothing to compare', () => {
    const result = compareDocuments(
      { type: 'root', children: [emptyTable(['left'])] },
      { type: 'root', children: [emptyTable(['right'])] },
    )

    expect(result.changes.map((change) => change.change)).toEqual(['changed'])
  })
})

describe('comparing inside other containers', () => {
  it('compares inside a directive that both revisions have, whatever it is called', () => {
    const result = compare(':::columns\nOld words.\n:::\n', ':::columns\nNew words.\n:::\n')

    expect(result.changes).toMatchObject([{ change: 'changed', block: 'block', wordsAdded: 1 }])
  })

  it('compares inside a directive that has no attributes at all', () => {
    const result = compareDocuments(
      { type: 'root', children: [bareDirective('Old words.')] },
      { type: 'root', children: [bareDirective('New words.')] },
    )

    expect(result.changes).toMatchObject([{ change: 'changed', wordsAdded: 1, wordsRemoved: 1 }])
  })

  it('shows a directive whose attributes changed before and after', () => {
    const result = compare(
      ':::columns{count=2}\nSame words.\n:::\n',
      ':::columns{count=3}\nSame words.\n:::\n',
    )

    expect(sides(result)).toEqual(['before', 'after'])
  })

  it('compares inside a details, in any syntax', () => {
    const result = compare(
      '<details>\n<summary>Why</summary>\n\nOld reason given.\n\n</details>\n',
      '<details>\n<summary>Why</summary>\n\nNew reason given.\n\n</details>\n',
    )

    expect(result.changes).toMatchObject([{ change: 'changed', wordsAdded: 1, wordsRemoved: 1 }])
  })
})

describe('naming what changed', () => {
  it.each([
    ['a divider', 'Text.\n', 'Text.\n\n---\n', 'divider'],
    [
      'a code group',
      '',
      ':::code-group\n```js [a.js]\nx\n```\n\n```ts [b.ts]\ny\n```\n:::\n',
      'code',
    ],
    ['a block nobody names', '', '<div>raw</div>\n', 'block'],
    ['a picture inside a link', '', '[![Plan](/a.png)](/plan)\n', 'image'],
    ['a code block with no language', '', '```\nplain\n```\n', 'code'],
    ['a callout', '', ':::tip\nAdvice.\n:::\n', 'callout'],
    ['a directive that is no callout', '', ':::columns\nText.\n:::\n', 'block'],
  ])('calls %s a %s block', (_name, before, after, block) => {
    expect(compare(before, after).changes.map((change) => change.block)).toContain(block)
  })

  it('does not call a paragraph an image because a picture sits beside a link', () => {
    const result = compare('', '![Plan](/a.png) and [a link](/x)\n')

    expect(result.changes.map((change) => change.block)).toEqual(['paragraph'])
  })

  it('does not call a link around words a picture', () => {
    const result = compare('', '[![Plan](/a.png) words](/x)\n')

    expect(result.changes.map((change) => change.block)).toEqual(['paragraph'])
  })
})

describe('naming a block that is already a comparison', () => {
  it('calls a code block compared by line a code block', () => {
    const compared: RootContent = { type: 'diffCode', lines: [] }
    const result = compareDocuments(
      { type: 'root', children: [] },
      { type: 'root', children: [compared] },
    )

    expect(result.changes).toMatchObject([{ change: 'added', block: 'code' }])
  })
})

describe('what a comparison leaves out', () => {
  it('reads past a node that is no block, wherever a tree built in memory puts one', () => {
    const stray: RootContent = { type: 'text', value: 'stray' }
    const result = compareDocuments(
      { type: 'root', children: [stray, paragraph('Old words.')] },
      { type: 'root', children: [paragraph('New words.'), stray] },
    )

    expect(result.changes).toMatchObject([{ change: 'changed' }])
  })
})
