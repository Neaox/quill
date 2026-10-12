import { describe, expect, it } from 'vitest'

import { cleanItems, mergeSequences, PAIRING_LIMIT } from './merge-sequences.ts'
import type { SequenceMergeOptions } from './merge-sequences.ts'
import { matchSequences } from './sequence-match.ts'

const words: SequenceMergeOptions<string> = { key: (word) => word }

/** Items are `type:text`; same type pairs, and a "modify" joins the two texts. */
interface Item {
  readonly type: string
  readonly text: string
}
const item = (spec: string): Item => {
  const [type = '', text = ''] = spec.split(':')
  return { type, text }
}
const items = (specs: string): Item[] => specs.split(' ').filter(Boolean).map(item)
const show = (list: readonly Item[] | undefined) =>
  list?.map(({ type, text }) => `${type}:${text}`).join(' ')
const blocks: SequenceMergeOptions<Item> = {
  key: ({ type, text }) => `${type}:${text}`,
  pairKey: ({ type }) => type,
}

describe('matchSequences', () => {
  it('matches a common prefix, a common suffix, and the longest run between', () => {
    expect([...matchSequences(['a', 'b', 'x', 'c', 'd'], ['a', 'b', 'c', 'y', 'd'])]).toEqual([
      0, 1, -1, 2, 4,
    ])
  })

  it('matches nothing in an empty sequence', () => {
    expect([...matchSequences([], ['a'])]).toEqual([])
    expect([...matchSequences(['a'], [])]).toEqual([-1])
  })
})

describe('mergeSequences', () => {
  it('merges words: edits to different words combine', () => {
    expect(
      cleanItems(mergeSequences(['a', 'b', 'c'], ['A', 'b', 'c'], ['a', 'b', 'C'], words)),
    ).toEqual(['A', 'b', 'C'])
  })

  it('makes a conflict of the same word replaced two ways', () => {
    expect(mergeSequences(['a', 'b'], ['a', 'x'], ['a', 'y'], words)).toEqual([
      { kind: 'merged', items: ['a'] },
      { kind: 'conflict', base: [], mine: ['x'], theirs: ['y'] },
    ])
  })

  it('pairs replaced items by type when it has no way to tell how alike they are', () => {
    const merged = mergeSequences(
      items('p:one h:two'),
      items('p:ONE h:two'),
      items('p:uno h:two'),
      {
        ...blocks,
        mergeItem: () => undefined,
      },
    )
    expect(merged[0]).toMatchObject({ kind: 'conflict' })
  })

  it('merges an item both changed with mergeItem', () => {
    const merged = mergeSequences(items('p:a'), items('p:b'), items('p:c'), {
      ...blocks,
      mergeItem: (_base, mine, theirs) => ({ type: 'p', text: `${mine.text}${theirs.text}` }),
    })
    expect(show(cleanItems(merged))).toBe('p:bc')
  })

  it('makes a conflict of an item both changed when there is no way to merge it', () => {
    expect(
      cleanItems(mergeSequences(items('p:a'), items('p:b'), items('p:c'), blocks)),
    ).toBeUndefined()
  })

  it('pairs by type alone above the pairing limit, where comparing every pair costs too much', () => {
    const size = Math.ceil(Math.sqrt(PAIRING_LIMIT)) + 1
    const base = Array.from({ length: size }, (_, index) => item(`p:b${index}`))
    const mine = Array.from({ length: size }, (_, index) => item(`p:m${index}`))
    const theirs = [...base, item('p:extra')]
    const similarity = () => 0
    const merged = cleanItems(
      mergeSequences(base, mine, theirs, { ...blocks, similarity, detectMoves: true }),
    )
    // Paired by type, each base item is a modification by mine: mine wins.
    expect(show(merged)).toBe(show([...mine, item('p:extra')]))
  })

  it('treats replaced items that share nothing as a deletion and an insertion', () => {
    const similarity = (before: Item, after: Item) => (before.text[0] === after.text[0] ? 1 : 0)
    const merged = mergeSequences(
      items('p:apple p:kiwi'),
      items('p:zebra p:kiwi'),
      items('p:avocado p:kiwi'),
      {
        ...blocks,
        similarity,
      },
    )
    // Mine deleted the apple (and wrote a zebra); theirs edited it: a conflict.
    expect(merged[0]).toMatchObject({ kind: 'conflict', mine: [], theirs: [item('p:avocado')] })
  })

  it('does not look for edited moves when there are too many candidates', () => {
    const size = PAIRING_LIMIT + 1
    const base = [
      item('p:keep'),
      ...Array.from({ length: size }, (_, index) => item(`p:gone${index}`)),
    ]
    const merged = mergeSequences(base, [item('p:keep'), item('h:new')], base, {
      ...blocks,
      similarity: () => 1,
      detectMoves: true,
    })
    expect(show(cleanItems(merged))).toBe('p:keep h:new')
  })

  it('follows an edited move with the other side’s edit, or conflicts if the two cannot merge', () => {
    const similarity = (before: Item, after: Item) => (before.text[0] === after.text[0] ? 0.9 : 0)
    const options = { ...blocks, similarity, detectMoves: true }
    const base = items('p:alpha p:bravo p:charlie')
    const mine = items('p:bravo p:charlie p:alpha2')
    const theirs = items('p:alpha3 p:bravo p:charlie')
    expect(mergeSequences(base, mine, theirs, options).at(-1)).toMatchObject({
      kind: 'conflict',
      mine: [item('p:alpha2')],
      theirs: [item('p:alpha3')],
    })
    expect(mergeSequences(base, theirs, mine, options).at(-1)).toMatchObject({
      kind: 'conflict',
      mine: [item('p:alpha3')],
      theirs: [item('p:alpha2')],
    })
    const merged = mergeSequences(base, mine, theirs, {
      ...options,
      mergeItem: (_base, ours, other) => ({ type: 'p', text: `${ours.text}+${other.text}` }),
    })
    expect(show(cleanItems(merged))).toBe('p:bravo p:charlie p:alpha2+alpha3')
  })

  it('ignores duplicate content when looking for moves', () => {
    const merged = mergeSequences(items('p:x p:y p:x'), items('p:y'), items('p:x p:y p:x'), {
      ...blocks,
      detectMoves: true,
    })
    expect(show(cleanItems(merged))).toBe('p:y')
  })

  it('keeps one side’s gap untouched when the other side inserted nothing there', () => {
    expect(cleanItems(mergeSequences(['a'], ['a', 'b'], ['a'], words))).toEqual(['a', 'b'])
    expect(cleanItems(mergeSequences(['a'], ['a'], ['a', 'b'], words))).toEqual(['a', 'b'])
  })
})

describe('mergeSequences: moves among duplicates', () => {
  it('does not take content inserted twice for a move', () => {
    const merged = mergeSequences(items('p:x p:y'), items('p:y p:x p:x'), items('p:x p:y'), {
      ...blocks,
      detectMoves: true,
    })
    expect(show(cleanItems(merged))).toBe('p:y p:x p:x')
  })
})
