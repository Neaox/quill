import { describe, expect, it } from 'vitest'
import type { Root } from 'mdast'

import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import type { DocumentMerge } from './merge-documents.ts'
import { contentKey, mergeDocuments, resolveMerge } from './merge-documents.ts'

const tree = (markdown: string): Root => parseMarkdown(markdown)
const markdownOf = (root: Root): string => stringifyMdast(root)

function merge(base: string, mine: string, theirs: string): DocumentMerge {
  return mergeDocuments(tree(base), tree(mine), tree(theirs))
}

/** The merged Markdown of a merge expected to be clean. */
function merged(base: string, mine: string, theirs: string): string {
  const result = merge(base, mine, theirs)
  expect(result.conflicts).toEqual([])
  return markdownOf(result.merged)
}

// A tree from another release can hold a node of a known type in an unknown
// shape; the merge refuses to guess, and offers both.
const odd = (...children: object[]): Root => ({ type: 'root', children: children as never })
const named = (name: string): Root => ({
  type: 'root',
  children: [{ type: 'thematicBreak', data: { hName: name } }],
})
const withData = (data: Record<string, string>): Root => ({
  type: 'root',
  children: [{ type: 'thematicBreak', data }],
})
const markedParagraph = (form: string, words: string): Root => ({
  type: 'root',
  children: [
    {
      type: 'paragraph',
      data: { sourceForm: { marker: form } } as never,
      children: [{ type: 'text', value: words }],
    },
  ],
})
const blocksOf = (blocks: readonly Root['children'][number][]): string =>
  markdownOf({ type: 'root', children: [...blocks] })

describe('mergeDocuments: whole documents', () => {
  const base = tree('# Title\n\nOne.\n')
  const edited = tree('# Title\n\nOne, edited.\n')

  it('is the identity when mine is unchanged: theirs comes back as it is', () => {
    expect(mergeDocuments(base, tree('# Title\n\nOne.\n'), edited)).toEqual({
      merged: edited,
      conflicts: [],
    })
  })

  it('is the identity when theirs is unchanged: mine comes back as it is', () => {
    const result = mergeDocuments(base, edited, tree('# Title\n\nOne.\n'))
    expect(result.merged).toBe(edited)
    expect(result.conflicts).toEqual([])
  })

  it('takes either when both sides made the same edit', () => {
    const result = mergeDocuments(base, edited, tree('# Title\n\nOne, edited.\n'))
    expect(result.conflicts).toEqual([])
    expect(markdownOf(result.merged)).toBe('# Title\n\nOne, edited.\n')
  })

  it('ignores where a block sat in the source when comparing content', () => {
    expect(contentKey(tree('Same.\n').children[0] ?? {})).toBe(
      contentKey(tree('\n\nSame.\n').children[0] ?? {}),
    )
  })
})

describe('mergeDocuments: blocks', () => {
  const base = 'Alpha.\n\nBravo.\n\nCharlie.\n\nDelta.\n'

  it('combines edits to different blocks', () => {
    expect(
      merged(
        base,
        'Alpha, mine.\n\nBravo.\n\nCharlie.\n\nDelta.\n',
        'Alpha.\n\nBravo.\n\nCharlie.\n\nDelta, theirs.\n',
      ),
    ).toBe('Alpha, mine.\n\nBravo.\n\nCharlie.\n\nDelta, theirs.\n')
  })

  it('combines edits to neighbouring blocks, which a line merge would not', () => {
    expect(
      merged(
        base,
        'Alpha.\n\nBravo, mine.\n\nCharlie.\n\nDelta.\n',
        'Alpha.\n\nBravo.\n\nCharlie, theirs.\n\nDelta.\n',
      ),
    ).toBe('Alpha.\n\nBravo, mine.\n\nCharlie, theirs.\n\nDelta.\n')
  })

  it('combines an insertion on one side with an edit of the next block on the other', () => {
    expect(
      merged(
        base,
        'Alpha.\n\nNew.\n\nBravo.\n\nCharlie.\n\nDelta.\n',
        'Alpha.\n\nBravo, theirs.\n\nCharlie.\n\nDelta.\n',
      ),
    ).toBe('Alpha.\n\nNew.\n\nBravo, theirs.\n\nCharlie.\n\nDelta.\n')
  })

  it('combines a deletion with an edit elsewhere', () => {
    expect(
      merged(
        base,
        'Alpha.\n\nCharlie.\n\nDelta.\n',
        'Alpha.\n\nBravo.\n\nCharlie.\n\nDelta, theirs.\n',
      ),
    ).toBe('Alpha.\n\nCharlie.\n\nDelta, theirs.\n')
  })

  it('deletes a block both sides deleted once', () => {
    expect(
      merged(base, 'Alpha.\n\nCharlie.\n\nDelta.\n', 'Alpha.\n\nCharlie.\n\nDelta.\n\nEcho.\n'),
    ).toBe('Alpha.\n\nCharlie.\n\nDelta.\n\nEcho.\n')
  })

  it('inserts the same new block once when both sides added it in the same place', () => {
    expect(
      merged(base, `${base}\nEcho.\n`, `Alpha!\n\nBravo.\n\nCharlie.\n\nDelta.\n\nEcho.\n`),
    ).toBe('Alpha!\n\nBravo.\n\nCharlie.\n\nDelta.\n\nEcho.\n')
  })

  it('follows a block one side moved with the other side’s edit of it', () => {
    expect(
      merged(
        base,
        'Bravo.\n\nCharlie.\n\nDelta.\n\nAlpha.\n',
        'Alpha, theirs.\n\nBravo.\n\nCharlie.\n\nDelta.\n',
      ),
    ).toBe('Bravo.\n\nCharlie.\n\nDelta.\n\nAlpha, theirs.\n')
  })

  it('follows a block when theirs moved it and mine edited it', () => {
    expect(
      merged(
        base,
        'Alpha.\n\nBravo, mine.\n\nCharlie.\n\nDelta.\n',
        'Alpha.\n\nCharlie.\n\nDelta.\n\nBravo.\n',
      ),
    ).toBe('Alpha.\n\nCharlie.\n\nDelta.\n\nBravo, mine.\n')
  })

  it('offers each place when both sides moved a block to different places', () => {
    const result = merge(
      base,
      'Bravo.\n\nCharlie.\n\nAlpha.\n\nDelta.\n',
      'Bravo.\n\nCharlie.\n\nDelta.\n\nAlpha.\n',
    )
    expect(markdownOf(result.merged)).toBe('Bravo.\n\nCharlie.\n\nDelta.\n')
    expect(result.conflicts.map(({ mine, theirs }) => [mine.length, theirs.length])).toEqual([
      [1, 0],
      [0, 1],
    ])
    const mineEverywhere = resolveMerge(result, [{ kind: 'mine' }, { kind: 'mine' }])
    expect(mineEverywhere && markdownOf(mineEverywhere)).toBe(
      'Bravo.\n\nCharlie.\n\nAlpha.\n\nDelta.\n',
    )
  })

  it('matches a block to itself whatever source form each side remembers for it', () => {
    const withMarker = (markdown: string, form: Record<string, unknown>): Root => {
      const root = tree(markdown)
      const [first, ...rest] = root.children
      return first === undefined
        ? root
        : { ...root, children: [{ ...first, data: { sourceForm: form } as never }, ...rest] }
    }
    const result = mergeDocuments(
      withMarker('Same.\n\nTwo.\n', { blankLines: 1 }),
      withMarker('Same.\n\nTwo, mine.\n', { blankLines: 2 }),
      withMarker('Theirs.\n\nSame.\n\nTwo.\n', { blankLines: 3 }),
    )
    expect(result.conflicts).toEqual([])
    expect(markdownOf(result.merged)).toBe('Theirs.\n\nSame.\n\nTwo, mine.\n')
  })

  it('moves a block once when both sides moved it to the same place', () => {
    const moved = 'Bravo.\n\nCharlie.\n\nDelta.\n\nAlpha.\n'
    const result = mergeDocuments(tree(base), tree(moved), tree(`Echo.\n\n${moved}`))
    expect(result.conflicts).toEqual([])
    expect(markdownOf(result.merged)).toBe(`Echo.\n\n${moved}`)
  })

  it('makes a conflict of a block one side moved and the other deleted', () => {
    const result = merge(
      base,
      'Bravo.\n\nCharlie.\n\nDelta.\n\nAlpha.\n',
      'Bravo.\n\nCharlie.\n\nDelta.\n',
    )
    expect(result.conflicts).toHaveLength(1)
    expect(blocksOf(result.conflicts[0]?.mine ?? [])).toBe('Alpha.\n')
    expect(result.conflicts[0]?.theirs).toEqual([])
    const flipped = merge(
      base,
      'Bravo.\n\nCharlie.\n\nDelta.\n',
      'Bravo.\n\nCharlie.\n\nDelta.\n\nAlpha.\n',
    )
    expect(flipped.conflicts[0]?.mine).toEqual([])
    expect(blocksOf(flipped.conflicts[0]?.theirs ?? [])).toBe('Alpha.\n')
  })

  it('makes a conflict of one side deleting a block the other edited', () => {
    const result = merge(
      base,
      'Alpha.\n\nCharlie.\n\nDelta.\n',
      'Alpha.\n\nBravo, theirs.\n\nCharlie.\n\nDelta.\n',
    )
    expect(result.conflicts).toHaveLength(1)
    const [conflict] = result.conflicts
    expect(conflict?.index).toBe(1)
    expect(blocksOf(conflict?.base ?? [])).toBe('Bravo.\n')
    expect(conflict?.mine).toEqual([])
    expect(blocksOf(conflict?.theirs ?? [])).toBe('Bravo, theirs.\n')
    expect(markdownOf(result.merged)).toBe('Alpha.\n\nCharlie.\n\nDelta.\n')
  })

  it('makes a conflict of two different blocks inserted in the same place', () => {
    const result = merge(base, `${base}\nMine.\n`, `${base}\nTheirs.\n`)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]?.base).toEqual([])
    expect(blocksOf(result.conflicts[0]?.mine ?? [])).toBe('Mine.\n')
    expect(blocksOf(result.conflicts[0]?.theirs ?? [])).toBe('Theirs.\n')
  })

  it('makes a conflict when the two sides changed a block into different kinds of block', () => {
    const result = merge(
      base,
      '# Alpha.\n\nBravo.\n\nCharlie.\n\nDelta.\n',
      '> Alpha.\n\nBravo.\n\nCharlie.\n\nDelta.\n',
    )
    expect(result.conflicts).toHaveLength(1)
  })

  it('joins neighbouring conflicts into one span', () => {
    const result = merge(
      'One two.\n\nThree four.\n',
      'One mine.\n\nThree mine.\n',
      'One theirs.\n\nThree theirs.\n',
    )
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]?.base).toHaveLength(2)
  })
})

describe('mergeDocuments: inside a block both sides changed', () => {
  it('merges a paragraph by words', () => {
    expect(
      merged(
        'The quick brown fox jumps over the lazy dog.\n',
        'The quick red fox jumps over the lazy dog.\n',
        'The quick brown fox jumps over the sleepy dog.\n',
      ),
    ).toBe('The quick red fox jumps over the sleepy dog.\n')
  })

  it('merges words inside inline formatting', () => {
    expect(
      merged(
        'Some *emphasised words here* and more.\n',
        'Some *emphasised phrases here* and more.\n',
        'Some *emphasised words here* and plenty more.\n',
      ),
    ).toBe('Some *emphasised phrases here* and plenty more.\n')
  })

  it('makes a conflict of the same word changed two ways', () => {
    const result = merge('A red apple.\n', 'A green apple.\n', 'A yellow apple.\n')
    expect(result.conflicts).toHaveLength(1)
    expect(blocksOf(result.conflicts[0]?.mine ?? [])).toBe('A green apple.\n')
    expect(blocksOf(result.conflicts[0]?.theirs ?? [])).toBe('A yellow apple.\n')
  })

  it('merges a heading’s level on one side with its words on the other', () => {
    expect(merged('## Getting started\n', '### Getting started\n', '## Getting going\n')).toBe(
      '### Getting going\n',
    )
  })

  it('merges a list by item', () => {
    expect(
      merged(
        '- one\n- two\n- three\n',
        '- one, mine\n- two\n- three\n- four\n',
        '- one\n- two\n- three, theirs\n',
      ),
    ).toBe('- one, mine\n- two\n- three, theirs\n- four\n')
  })

  it('merges a nested list item by item', () => {
    expect(
      merged(
        '- one\n  - inner a\n  - inner b\n- two\n',
        '- one\n  - inner a, mine\n  - inner b\n- two\n',
        '- one\n  - inner a\n  - inner b, theirs\n- two\n',
      ),
    ).toBe('- one\n  - inner a, mine\n  - inner b, theirs\n- two\n')
  })

  it('merges a task’s checkbox on one side with its words on the other', () => {
    expect(
      merged(
        '- [ ] write it\n- [ ] ship it\n',
        '- [x] write it\n- [ ] ship it\n',
        '- [ ] write it all\n- [ ] ship it\n',
      ),
    ).toBe('- [x] write it all\n- [ ] ship it\n')
  })

  it('merges a table by row, then by cell', () => {
    const base = '| Name | Role |\n| --- | --- |\n| Ana | Lead |\n| Ben | Dev |\n'
    expect(
      merged(
        base,
        '| Name | Role |\n| --- | --- |\n| Ana | Principal |\n| Ben | Dev |\n',
        '| Name | Role |\n| --- | --- |\n| Ana Lima | Lead |\n| Ben | Dev |\n| Cy | QA |\n',
      ),
    ).toBe('| Name | Role |\n| --- | --- |\n| Ana Lima | Principal |\n| Ben | Dev |\n| Cy | QA |\n')
  })

  it('makes a conflict of one cell changed two ways', () => {
    const base = '| A |\n| - |\n| x |\n'
    expect(merge(base, '| A |\n| - |\n| y |\n', '| A |\n| - |\n| z |\n').conflicts).toHaveLength(1)
  })

  it('merges a code block by line, keeping its language from the side that changed it', () => {
    expect(
      merged(
        '```js\nconst a = 1\nconst b = 2\nconst c = 3\n```\n',
        '```ts\nconst a = 10\nconst b = 2\nconst c = 3\n```\n',
        '```js\nconst a = 1\nconst b = 2\nconst c = 30\n```\n',
      ),
    ).toBe('```ts\nconst a = 10\nconst b = 2\nconst c = 30\n```\n')
  })

  it('makes a conflict of one line of code changed two ways', () => {
    expect(
      merge('```\nx = 1\n```\n', '```\nx = 2\n```\n', '```\nx = 3\n```\n').conflicts,
    ).toHaveLength(1)
  })

  it('makes a conflict of a field changed two ways', () => {
    expect(merge('```js\nx\n```\n', '```ts\ny\n```\n', '```py\nx\n```\n').conflicts).toHaveLength(1)
  })

  it('merges a directive by attribute, and its body by block', () => {
    expect(
      merged(
        ':::callout{type=note title="Read me"}\nFirst.\n\nSecond.\n:::\n',
        ':::callout{type=warning title="Read me"}\nFirst, mine.\n\nSecond.\n:::\n',
        ':::callout{type=note title="Read this"}\nFirst.\n\nSecond, theirs.\n:::\n',
      ),
      // Attributes that changed are written in the serialiser's canonical form.
    ).toBe(':::callout{type="warning" title="Read this"}\nFirst, mine.\n\nSecond, theirs.\n:::\n')
  })

  it('makes a conflict of one attribute changed two ways', () => {
    expect(
      merge(
        ':::callout{type=note}\nBody.\n:::\n',
        ':::callout{type=warning}\nBody.\n:::\n',
        ':::callout{type=tip}\nBody.\n:::\n',
      ).conflicts,
    ).toHaveLength(1)
  })

  it('merges a leaf directive’s label by word and its attributes by attribute', () => {
    expect(
      merged(
        '::embed[A short label]{src=a.png}\n',
        '::embed[A long label]{src=a.png}\n',
        '::embed[A short label]{src=b.png}\n',
      ),
    ).toBe('::embed[A long label]{src=b.png}\n')
  })

  it('merges front matter by field', () => {
    expect(
      merged(
        '---\ntitle: Plan\nowner: Ana\n---\n\nBody.\n',
        '---\ntitle: The plan\nowner: Ana\n---\n\nBody.\n',
        '---\ntitle: Plan\nowner: Ben\n---\n\nBody.\n',
      ),
    ).toBe('---\ntitle: The plan\nowner: Ben\n---\n\nBody.\n')
  })

  it('merges front matter fields whose lines touch, value by value', () => {
    const result = merged(
      '---\ntags:\n  - a\nstatus: draft\n---\n',
      '---\ntags:\n  - a\n  - b\nstatus: draft\n---\n',
      '---\ntags:\n  - a\nstatus: review\n---\n',
    )
    expect(result).toContain('status: review')
    expect(result).toContain('- b')
  })

  it('makes a conflict of one front-matter field changed two ways', () => {
    expect(
      merge('---\ntitle: A\n---\n', '---\ntitle: B\n---\n', '---\ntitle: C\n---\n').conflicts,
    ).toHaveLength(1)
  })

  it('makes a conflict of front matter that no longer reads as YAML', () => {
    expect(
      merge('---\ntitle: A\n---\n', '---\ntitle: [B\n---\n', '---\ntitle: C\n---\n').conflicts,
    ).toHaveLength(1)
  })

  it('merges HTML by line', () => {
    expect(
      merged(
        '<div>\n<p>one</p>\n<p>two</p>\n</div>\n',
        '<div>\n<p>uno</p>\n<p>two</p>\n</div>\n',
        '<div>\n<p>one</p>\n<p>dos</p>\n</div>\n',
      ),
    ).toBe('<div>\n<p>uno</p>\n<p>dos</p>\n</div>\n')
  })

  it('merges a blockquote by block', () => {
    expect(
      merged('> One.\n>\n> Two.\n', '> One, mine.\n>\n> Two.\n', '> One.\n>\n> Two, theirs.\n'),
    ).toBe('> One, mine.\n>\n> Two, theirs.\n')
  })

  it('makes a conflict of a node whose children and value disagree in shape', () => {
    const result = mergeDocuments(
      odd({ type: 'paragraph', children: [{ type: 'text', value: 'same' }] }),
      odd({ type: 'paragraph', children: [{ type: 'text', value: 'same mine' }] }),
      odd({ type: 'paragraph', value: 'same theirs' }),
    )
    expect(result.conflicts).toHaveLength(1)
  })

  it('makes a conflict of a node whose value one side no longer has', () => {
    const result = mergeDocuments(
      odd({ type: 'custom', value: '' }),
      odd({ type: 'custom', value: '', flag: true }),
      odd({ type: 'custom' }),
    )
    expect(result.conflicts).toHaveLength(1)
  })

  it('merges fields one side removed and the other kept', () => {
    const result = mergeDocuments(
      odd({ type: 'thematicBreak', data: { a: 1, b: 1 } }),
      odd({ type: 'thematicBreak', data: { b: 2 } }),
      odd({ type: 'thematicBreak', data: { a: 1, b: 1, c: 3 } }),
    )
    expect(result.merged.children).toEqual([{ type: 'thematicBreak', data: { b: 2, c: 3 } }])
  })

  it('drops a field one side removed and the other left alone', () => {
    const result = mergeDocuments(
      odd({ type: 'thematicBreak', data: { a: 1 }, extra: 'x' }),
      odd({ type: 'thematicBreak', data: { a: 2 }, extra: 'x' }),
      odd({ type: 'thematicBreak', data: { a: 1 } }),
    )
    expect(result.merged.children).toEqual([{ type: 'thematicBreak', data: { a: 2 } }])
  })

  it('merges records a side added or removed whole, key by key', () => {
    const added = mergeDocuments(
      odd({ type: 'thematicBreak' }),
      odd({ type: 'thematicBreak', data: { a: 1 } }),
      odd({ type: 'thematicBreak', data: { b: 2 } }),
    )
    expect(added.merged.children).toEqual([{ type: 'thematicBreak', data: { a: 1, b: 2 } }])
    const removed = mergeDocuments(
      odd({ type: 'thematicBreak', data: { a: 1 } }),
      odd({ type: 'thematicBreak' }),
      odd({ type: 'thematicBreak', data: { a: 1, b: 2 } }),
    )
    expect(removed.merged.children).toEqual([{ type: 'thematicBreak', data: { b: 2 } }])
  })

  it('makes a conflict of a record one side removed and the other changed', () => {
    const result = mergeDocuments(
      odd({ type: 'thematicBreak', data: { a: 1 } }),
      odd({ type: 'thematicBreak', data: { a: 2 } }),
      odd({ type: 'thematicBreak' }),
    )
    expect(result.conflicts).toHaveLength(1)
  })

  it('merges front matter whose one line both sides changed, field by field', () => {
    expect(
      merged(
        '---\n{ a: 1, b: 2 }\n---\n',
        '---\n{ a: 9, b: 2 }\n---\n',
        '---\n{ a: 1, b: 8 }\n---\n',
      ),
    ).toBe('---\n{ a: 9, b: 8 }\n---\n')
  })

  it('takes a block both sides edited the same way, beside one only theirs edited', () => {
    expect(merged('One.\n\nTwo.\n', 'One, both.\n\nTwo.\n', 'One, both.\n\nTwo, theirs.\n')).toBe(
      'One, both.\n\nTwo, theirs.\n',
    )
  })

  it('makes a conflict of a leaf with no value that both sides changed', () => {
    expect(mergeDocuments(named('a'), named('b'), named('c')).conflicts).toHaveLength(1)
  })

  it('merges a leaf with no value by its fields', () => {
    const result = mergeDocuments(
      withData({ a: '1', b: '1' }),
      withData({ a: '2', b: '1' }),
      withData({ a: '1', b: '2' }),
    )
    expect(result.conflicts).toEqual([])
    expect(result.merged.children[0]).toEqual({ type: 'thematicBreak', data: { a: '2', b: '2' } })
  })

  it('drops a remembered source form both sides changed rather than conflict over it', () => {
    const result = mergeDocuments(
      markedParagraph('*', 'one two three'),
      markedParagraph('_', 'one 2 three'),
      markedParagraph('-', 'one two 3'),
    )
    expect(result.conflicts).toEqual([])
    expect(result.merged.children[0]).toEqual({
      type: 'paragraph',
      data: {},
      children: [{ type: 'text', value: 'one 2 3' }],
    })
  })

  it('removes a field one side removed', () => {
    const result = merged('```js\na\nb\n```\n', '```\na\nb\n```\n', '```js\na\nB\n```\n')
    expect(result).toBe('```\na\nB\n```\n')
  })
})

describe('resolveMerge', () => {
  const result = merge(
    'Intro.\n\nA red apple.\n\nMiddle.\n\nA red pear.\n\nEnd.\n',
    'Intro.\n\nA green apple.\n\nMiddle.\n\nA green pear.\n\nEnd.\n',
    'Intro.\n\nA yellow apple.\n\nMiddle.\n\nA yellow pear.\n\nEnd.\n',
  )

  it('finds each conflict in its place', () => {
    expect(result.conflicts.map(({ index }) => index)).toEqual([1, 2])
  })

  it('is incomplete while any conflict is open', () => {
    expect(resolveMerge(result, [{ kind: 'mine' }])).toBeUndefined()
  })

  it('puts each resolution in its conflict’s place', () => {
    const resolved = resolveMerge(result, [{ kind: 'mine' }, { kind: 'theirs' }])
    expect(resolved && markdownOf(resolved)).toBe(
      'Intro.\n\nA green apple.\n\nMiddle.\n\nA yellow pear.\n\nEnd.\n',
    )
  })

  it('keeps both with mine below theirs, and takes an edit as written', () => {
    const resolved = resolveMerge(result, [
      { kind: 'both' },
      { kind: 'edited', blocks: tree('A blended pear.\n').children },
    ])
    expect(resolved && markdownOf(resolved)).toBe(
      'Intro.\n\nA yellow apple.\n\nA green apple.\n\nMiddle.\n\nA blended pear.\n\nEnd.\n',
    )
  })

  it('returns a clean merge as it is', () => {
    const clean = merge('A.\n', 'B.\n', 'A.\n')
    expect(resolveMerge(clean, [])).toEqual(clean.merged)
  })
})
