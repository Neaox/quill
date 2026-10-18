import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { Edit } from './sequence.ts'
import { diffSequences } from './sequence.ts'

const identity = (value: string) => value

/** Replays an edit script: what `before` becomes when the script is applied. */
function apply(before: readonly string[], after: readonly string[], edits: readonly Edit[]) {
  return edits.flatMap((edit) => {
    if (edit.kind === 'removed') return []
    if (edit.kind === 'added') return [after[edit.after]]
    return [before[edit.before]]
  })
}

function kinds(edits: readonly Edit[]): string {
  return edits.map((edit) => edit.kind[0]).join('')
}

/** The length of the longest common subsequence, by dynamic programming. */
function lcs(left: readonly string[], right: readonly string[]): number {
  const table = Array.from({ length: left.length + 1 }, () =>
    Array.from({ length: right.length + 1 }, () => 0),
  )
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      const row = table[i] ?? []
      row[j] =
        left[i] === right[j]
          ? (table[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(table[i + 1]?.[j] ?? 0, row[j + 1] ?? 0)
    }
  }
  return table[0]?.[0] ?? 0
}

describe('diffSequences', () => {
  it('finds nothing to do between equal sequences', () => {
    expect(kinds(diffSequences(['a', 'b'], ['a', 'b'], identity))).toBe('ee')
  })

  it('reports an insertion and a removal against the longest common run', () => {
    const edits = diffSequences(['a', 'b', 'c'], ['a', 'x', 'c'], identity)
    expect(kinds(edits)).toBe('erae')
  })

  it('puts every removal of a stretch before its additions', () => {
    const edits = diffSequences(['a', 'b', 'c', 'd'], ['a', 'x', 'y', 'd'], identity)
    expect(kinds(edits)).toBe('erraae')
  })

  it('handles empty sides', () => {
    expect(kinds(diffSequences([], ['a'], identity))).toBe('a')
    expect(kinds(diffSequences(['a'], [], identity))).toBe('r')
    expect(diffSequences([], [], identity)).toEqual([])
  })

  it('stays linear for a rewrite too large to search', () => {
    const before = Array.from({ length: 6000 }, (_, index) => `b${index}`)
    const after = Array.from({ length: 6000 }, (_, index) => `a${index}`)
    const started = performance.now()
    const edits = diffSequences(before, after, identity)
    expect(performance.now() - started).toBeLessThan(2000)
    expect(apply(before, after, edits)).toEqual(after)
  })

  it('replays to the newer sequence, keeping a common subsequence of the two', () => {
    const items = fc.array(fc.constantFrom('a', 'b', 'c', 'd', 'e'), { maxLength: 40 })
    fc.assert(
      fc.property(items, items, (before, after) => {
        const edits = diffSequences(before, after, identity)
        expect(apply(before, after, edits)).toEqual(after)
        // Every equal pair really is equal, and both sides are walked in order.
        const pairs = edits.flatMap((edit) =>
          edit.kind === 'equal' ? [[before[edit.before], after[edit.after]] as const] : [],
        )
        expect(pairs.map(([left]) => left)).toEqual(pairs.map(([, right]) => right))
        expect(edits.flatMap((edit) => (edit.kind === 'added' ? [] : [edit.before]))).toEqual(
          before.map((_, index) => index),
        )
        expect(edits.flatMap((edit) => (edit.kind === 'removed' ? [] : [edit.after]))).toEqual(
          after.map((_, index) => index),
        )
      }),
    )
  })

  it('finds a shortest script: no fewer equal pairs than the longest common subsequence', () => {
    const items = fc.array(fc.constantFrom('a', 'b', 'c'), { maxLength: 25 })
    fc.assert(
      fc.property(items, items, (before, after) => {
        const equal = diffSequences(before, after, identity).filter(
          (edit) => edit.kind === 'equal',
        ).length
        expect(equal).toBe(lcs(before, after))
      }),
    )
  })
})
