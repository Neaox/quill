import * as fc from 'fast-check'
import type { RootContent } from 'mdast'
import { toString } from 'mdast-util-to-string'
import { describe, expect, it } from 'vitest'

import { parseMarkdown } from '../pipeline/processor.ts'
import type { BlockAlignment } from './blocks.ts'
import { alignBlocks, similarity } from './blocks.ts'

function blocks(markdown: string): RootContent[] {
  return parseMarkdown(markdown).children
}

/** The alignment as `kind:text` pairs, newer text where there is one. */
function show(alignment: readonly BlockAlignment<RootContent>[]): string[] {
  return alignment.map((entry) => {
    const node = entry.kind === 'removed' ? entry.before : entry.after
    return `${entry.kind}:${toString(node)}`
  })
}

describe('alignBlocks', () => {
  it('keeps unchanged blocks and marks an added one', () => {
    expect(show(alignBlocks(blocks('One.\n\nTwo.'), blocks('One.\n\nNew.\n\nTwo.')))).toEqual([
      'unchanged:One.',
      'added:New.',
      'unchanged:Two.',
    ])
  })

  it('pairs an edited paragraph with its older self rather than calling it a replacement', () => {
    expect(
      show(
        alignBlocks(
          blocks('Intro.\n\nThe service restarts nightly at two.\n\nEnd.'),
          blocks('Intro.\n\nThe service restarts nightly at three.\n\nEnd.'),
        ),
      ),
    ).toEqual([
      'unchanged:Intro.',
      'changed:The service restarts nightly at three.',
      'unchanged:End.',
    ])
  })

  it('calls an unrelated block in the same place a removal and an addition, removal first', () => {
    expect(
      show(
        alignBlocks(
          blocks('A.\n\nApples are red.\n\nZ.'),
          blocks('A.\n\nQueues drain slowly.\n\nZ.'),
        ),
      ),
    ).toEqual([
      'unchanged:A.',
      'removed:Apples are red.',
      'added:Queues drain slowly.',
      'unchanged:Z.',
    ])
  })

  it('recognises a block moved elsewhere', () => {
    const before = blocks('# Title\n\nFirst paragraph with enough words.\n\nSecond.\n\nThird.')
    const after = blocks('# Title\n\nSecond.\n\nThird.\n\nFirst paragraph with enough words.')
    expect(show(alignBlocks(before, after))).toEqual([
      'unchanged:Title',
      'unchanged:Second.',
      'unchanged:Third.',
      'moved:First paragraph with enough words.',
    ])
  })

  it('never pairs blocks of different kinds', () => {
    const alignment = alignBlocks(blocks('Some words here.'), blocks('## Some words here'))
    expect(alignment.map((entry) => entry.kind)).toEqual(['removed', 'added'])
  })

  it('accounts for every block of both sides exactly once, in order', () => {
    const paragraph = fc.constantFrom(
      'Alpha beta.',
      'Gamma delta epsilon.',
      'Alpha beta gamma.',
      '# Heading',
      '- item one\n- item two',
      '```\ncode\n```',
      '---',
    )
    fc.assert(
      fc.property(
        fc.array(paragraph, { maxLength: 8 }),
        fc.array(paragraph, { maxLength: 8 }),
        (left, right) => {
          const before = blocks(left.join('\n\n'))
          const after = blocks(right.join('\n\n'))
          const alignment = alignBlocks(before, after)
          const fromBefore = alignment.flatMap((entry) =>
            entry.kind === 'added' ? [] : [entry.before],
          )
          const fromAfter = alignment.flatMap((entry) =>
            entry.kind === 'removed' ? [] : [entry.after],
          )
          expect(fromAfter).toEqual(after)
          expect(new Set(fromBefore).size).toBe(before.length)
          const unequalKept = alignment.filter(
            (entry) =>
              (entry.kind === 'unchanged' || entry.kind === 'moved') &&
              toString(entry.before) !== toString(entry.after),
          )
          const retyped = alignment.filter(
            (entry) => entry.kind === 'changed' && entry.before.type !== entry.after.type,
          )
          expect(unequalKept).toEqual([])
          expect(retyped).toEqual([])
        },
      ),
    )
  })
})

describe('a region too large to score every pair of its blocks', () => {
  const COUNT = 205 // 205 x 205 candidate pairs is past the budget for scoring them all

  it('pairs the blocks that sit in the same place and are alike, and no others', () => {
    const older = Array.from({ length: COUNT }, (_, index) => `Entry${String(index)} stays here.`)
    const newer = older.map((text, index) =>
      index === 7 ? 'Completely unrelated sentence.' : `${text} Extended.`,
    )
    const alignment = alignBlocks(blocks(older.join('\n\n')), blocks(newer.join('\n\n')))
    const kinds = Object.groupBy(alignment, (entry) => entry.kind)
    expect(kinds.changed).toHaveLength(COUNT - 1)
    expect(kinds.removed).toHaveLength(1)
    expect(kinds.added).toHaveLength(1)
    expect(kinds.unchanged).toBeUndefined()
  })
})

describe('similarity', () => {
  it('is one for two blocks with no words at all, and zero against one that has some', () => {
    const [rule, otherRule, words] = blocks('---\n\n***\n\nSome words.')
    if (rule === undefined || otherRule === undefined || words === undefined) {
      throw new Error('blocks')
    }
    expect(similarity(rule, otherRule)).toBe(1)
    expect(similarity(rule, words)).toBe(0)
    expect(similarity(words, rule)).toBe(0)
  })

  it('is one for equal text and zero for nothing in common', () => {
    const [left, right, other] = blocks('Same words.\n\nSame words.\n\nDifferent things.')
    if (left === undefined || right === undefined || other === undefined) throw new Error('blocks')
    expect(similarity(left, right)).toBe(1)
    expect(similarity(left, other)).toBe(0)
  })
})
