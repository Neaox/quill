import type { Paragraph } from 'mdast'
import { describe, expect, it } from 'vitest'

import { alignBlocks } from './blocks.ts'

const paragraph = (value: string): Paragraph => ({
  type: 'paragraph',
  children: [{ type: 'text', value }],
})

/** Blocks that share most of their words with the one at the same place on the other side. */
const edited = (suffix: string, count: number): Paragraph[] =>
  Array.from({ length: count }, (_, index) =>
    paragraph(`item${String(index)}${suffix} shares most of these words`),
  )

describe('aligning more blocks than can be scored against one another', () => {
  it('pairs them by position, and leaves a block with nothing like it unpaired', () => {
    const before = edited('a', 201)
    const after = edited('b', 201)
    before[5] = paragraph('Nothing here resembles its neighbour at all')

    const kinds = Object.entries(Object.groupBy(alignBlocks(before, after), ({ kind }) => kind))

    expect(kinds.map(([kind, entries]) => [kind, entries?.length])).toEqual([
      ['changed', 200],
      ['removed', 1],
      ['added', 1],
    ])
  })
})
