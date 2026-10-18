import type { Parent, Root, RootContent, Table } from 'mdast'
import { describe, expect, it } from 'vitest'

import { parseDocument } from '../pipeline/parse-document.ts'
import { compareDocuments, compareProperties } from './compare.ts'

const tree = (markdown: string): Root => parseDocument(markdown).ast

const compare = (before: string, after: string) => compareDocuments(tree(before), tree(after))

const marks = (node: RootContent): Record<string, unknown> => node.data?.hProperties ?? {}

/** What the comparison said of each child of a container, in order. */
function changesOf(node: RootContent | undefined): unknown[] {
  if (node === undefined || !('children' in node)) throw new Error('expected a container')
  const children: readonly RootContent[] = (node as Parent).children as RootContent[]
  return children.map((child) => marks(child)['data-change'])
}

const details = (body: string) => `<details>\n<summary>Why</summary>\n\n${body}\n\n</details>\n`

const directive = (word: string): Root => ({
  type: 'root',
  children: [
    {
      type: 'containerDirective',
      name: 'note',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: `${word} advice about the ports.` }],
        },
      ],
    },
  ],
})

const group = (command: string) =>
  `:::code-group\n\`\`\`sh [npm]\n${command}\n\`\`\`\n\n\`\`\`sh [pnpm]\npnpm install\n\`\`\`\n:::\n`

const table = (...rows: string[]) => `${rows.join('\n')}\n`

const empty = (): Root => ({ type: 'root', children: [{ type: 'table', children: [] }] })

describe('comparing inside a block quote', () => {
  it('compares its blocks as the document is compared', () => {
    const result = compare(
      [
        '> Keep this opening.',
        '>',
        '> Gone entirely from here.',
        '>',
        '> Old advice about ports.',
        '>',
        '> Stays where it is.',
        '',
      ].join('\n'),
      [
        '> Keep this opening.',
        '>',
        '> New advice about ports.',
        '>',
        '> Stays where it is.',
        '>',
        '> Brand new closing words.',
        '',
      ].join('\n'),
    )
    expect(result.changes).toMatchObject([{ change: 'changed', block: 'quote' }])
    expect(changesOf(result.tree.children[0])).toEqual([
      undefined,
      'removed',
      'changed',
      undefined,
      'added',
    ])
  })

  it('shows a paragraph that moved inside a quote once, where it went', () => {
    const result = compare(
      '> First.\n>\n> This paragraph moves down.\n>\n> Middle.\n>\n> End.\n',
      '> First.\n>\n> Middle.\n>\n> End.\n>\n> This paragraph moves down.\n',
    )
    expect(changesOf(result.tree.children[0])).toContain('moved')
  })
})

describe('comparing inside a details', () => {
  it('compares the body of a details written in HTML', () => {
    const result = compare(
      details('Because of the old reason.'),
      details('Because of the new reason.'),
    )
    expect(result.changes).toMatchObject([{ change: 'changed', block: 'block' }])
    expect(result.changes[0]?.wordsAdded).toBe(1)
    expect(result.changes[0]?.wordsRemoved).toBe(1)
  })
})

describe('comparing directives', () => {
  it('compares inside a directive whose name and attributes are the same', () => {
    const result = compare(
      ':::note{title="Heads up"}\nOld advice about the ports.\n:::\n',
      ':::note{title="Heads up"}\nNew advice about the ports.\n:::\n',
    )
    expect(result.changes).toMatchObject([{ change: 'changed', block: 'callout', wordsAdded: 1 }])
    expect(result.tree.children).toHaveLength(1)
  })

  it('compares inside directives built with no attributes at all', () => {
    const result = compareDocuments(directive('Old'), directive('New'))
    expect(result.changes).toMatchObject([{ change: 'changed', block: 'callout' }])
    expect(result.tree.children).toHaveLength(1)
  })

  it('shows both versions when the kind of directive changed', () => {
    const result = compare(
      ':::note\nThe very same advice words here.\n:::\n',
      ':::tip\nThe very same advice words here.\n:::\n',
    )
    expect(result.tree.children.map((node) => marks(node)['data-side'])).toEqual([
      'before',
      'after',
    ])
  })

  it('shows both versions when the attributes of a directive changed', () => {
    const result = compare(
      ':::note{title="One"}\nThe very same advice words here.\n:::\n',
      ':::note{title="Two"}\nThe very same advice words here.\n:::\n',
    )
    expect(result.tree.children.map((node) => marks(node)['data-side'])).toEqual([
      'before',
      'after',
    ])
  })
})

describe('blocks that change what they are', () => {
  it('shows a list that became an ordered list before and after', () => {
    const result = compare('- one two three four\n', '1. one two three four\n')
    expect(result.tree.children.map((node) => marks(node)['data-side'])).toEqual([
      'before',
      'after',
    ])
  })

  it('shows a code block that changed language before and after', () => {
    const result = compare('```ts\nconst a = 1\n```\n', '```js\nconst a = 1\n```\n')
    expect(result.tree.children.map((node) => marks(node)['data-side'])).toEqual([
      'before',
      'after',
    ])
  })

  it('shows a changed code group before and after, and calls it code', () => {
    const result = compare(group('npm install'), group('npm ci'))
    expect(result.changes).toMatchObject([{ change: 'changed', block: 'code' }])
  })
})

describe('comparing tables', () => {
  it('shows a table whose columns changed before and after', () => {
    const result = compare(
      table('| Name | Port |', '| --- | --- |', '| api | 3000 |'),
      table('| Name | Port | Host |', '| --- | --- | --- |', '| api | 3000 | local |'),
    )
    expect(result.tree.children.map((node) => marks(node)['data-side'])).toEqual([
      'before',
      'after',
    ])
  })

  it('shows tables that have no rows at all before and after', () => {
    const first = empty()
    const result = compareDocuments(first, empty())
    // Equal tables are not a change; one that gained a header is.
    expect(result.changes).toEqual([])
    const headed: Table = {
      type: 'table',
      children: [
        {
          type: 'tableRow',
          children: [{ type: 'tableCell', children: [{ type: 'text', value: 'Name' }] }],
        },
      ],
    }
    const grown = compareDocuments(first, { type: 'root', children: [headed] })
    expect(grown.changes).toHaveLength(2)
  })

  it('marks rows that were taken out and rows that moved', () => {
    const result = compare(
      table(
        '| Name | Note |',
        '| --- | --- |',
        '| api | the first service in the list |',
        '| web | a row that is going away soon |',
        '| db | the row that will move to the end |',
        '| queue | the last service of all of them |',
      ),
      table(
        '| Name | Note |',
        '| --- | --- |',
        '| api | the first service in the list |',
        '| queue | the last service of all of them |',
        '| db | the row that will move to the end |',
      ),
    )
    const [changed] = result.tree.children
    if (changed?.type !== 'table') throw new Error('expected a table')
    const rows = changed.children.map((row) => marks(row)['data-change'])
    expect(rows).toContain('removed')
    expect(rows).toContain('moved')
  })

  it('compares a row with fewer cells than the header against the cells it gained', () => {
    const result = compare(
      table('| Name | Port |', '| --- | --- |', '| api |'),
      table('| Name | Port |', '| --- | --- |', '| api | 3000 |'),
    )
    const [changed] = result.tree.children
    if (changed?.type !== 'table') throw new Error('expected a table')
    expect(marks(changed.children[1] ?? changed)['data-change']).toBe('changed')
  })
})

describe('comparing lists', () => {
  it('marks items that were taken out and items that moved, and compares inside the ones that changed', () => {
    const result = compare(
      [
        '- the first item stays',
        '- a second item going away soon',
        '- an item that will move to the end',
        '- the last item of all of them',
        '',
      ].join('\n'),
      [
        '- the first item stays',
        '- the last item of all of them',
        '- an item that will move to the end',
        '',
      ].join('\n'),
    )
    const [list] = result.tree.children
    const items = changesOf(list)
    expect(items).toContain('removed')
    expect(items).toContain('moved')
  })
})

describe('pictures', () => {
  it('sees a picture written as a reference, and one a link is wrapped around', () => {
    const result = compare(
      '![Plan][a]\n\n[![Chart][b]](https://example.com)\n\n[a]: /a.png\n[b]: /b.png\n',
      '![Plan][a]\n\n[![Chart][b]](https://example.org)\n\n[a]: /a.png\n[b]: /b.png\n',
    )
    expect(result.changes.map((change) => change.block)).toEqual(['image'])
  })
})

describe('what kind of block a change is', () => {
  it('names a divider, and calls anything it has no name for a block', () => {
    const result = compare('Intro.\n', 'Intro.\n\n---\n\n<div>raw html here</div>\n')
    expect(result.changes.map((change) => change.block)).toEqual(['divider', 'block'])
  })
})

describe('what a comparison leaves out', () => {
  it('ignores a top-level node that is not a block at all', () => {
    const stray: Root = {
      type: 'root',
      children: [
        { type: 'text', value: 'stray' },
        { type: 'paragraph', children: [{ type: 'text', value: 'Real.' }] },
      ],
    }
    const result = compareDocuments(stray, stray)
    expect(result.changes).toEqual([])
    expect(result.tree.children).toHaveLength(1)
  })
})

describe('comparing properties of every shape', () => {
  it('lists a property that was taken out, with only its older value', () => {
    expect(compareProperties({ title: 'Guide', owner: 'ada' }, { title: 'Guide' })).toEqual([
      { name: 'owner', before: 'ada' },
    ])
  })

  it('reads a list as its items, a date as its day, and an object as its JSON', () => {
    expect(
      compareProperties(
        { tags: ['a', null], due: new Date('2026-01-02T10:00:00Z'), meta: { a: 1 } },
        { tags: ['a'], due: new Date('2026-01-03T10:00:00Z'), meta: { a: 2 } },
      ),
    ).toEqual([
      { name: 'tags', before: 'a, ', after: 'a' },
      { name: 'due', before: '2026-01-02', after: '2026-01-03' },
      { name: 'meta', before: '{"a":1}', after: '{"a":2}' },
    ])
  })
})
