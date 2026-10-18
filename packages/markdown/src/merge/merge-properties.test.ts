import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Root, RootContent } from 'mdast'

import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import type { DocumentMerge } from './merge-documents.ts'
import { contentKey, mergeDocuments } from './merge-documents.ts'

/**
 * The four properties ADR-021's amendment asks of the merge, over generated
 * documents and generated edits of them. Every word of a generated base is
 * unique, and every word a side writes is new and marked as that side's, so
 * "was this change kept?" is a question about which words survive.
 */

type Paragraphs = readonly (readonly string[])[]

type Edit =
  | { readonly kind: 'reword'; readonly block: number; readonly word: number }
  | { readonly kind: 'insert'; readonly at: number }
  | { readonly kind: 'delete'; readonly block: number }
  | { readonly kind: 'move'; readonly from: number; readonly to: number }

const editArbitrary: fc.Arbitrary<Edit> = fc.oneof(
  fc.record({ kind: fc.constant('reword' as const), block: fc.nat(9), word: fc.nat(4) }),
  fc.record({ kind: fc.constant('insert' as const), at: fc.nat(9) }),
  fc.record({ kind: fc.constant('delete' as const), block: fc.nat(9) }),
  fc.record({ kind: fc.constant('move' as const), from: fc.nat(9), to: fc.nat(9) }),
)

const baseArbitrary: fc.Arbitrary<Paragraphs> = fc
  .array(fc.integer({ min: 1, max: 5 }), { maxLength: 8 })
  .map((lengths) =>
    lengths.map((length, block) => Array.from({ length }, (_, word) => `b${block}w${word}`)),
  )

/** Applies edits in order; `side` marks every word it writes. */
function edit(base: Paragraphs, edits: readonly Edit[], side: 'm' | 't'): Paragraphs {
  const blocks = base.map((words) => [...words])
  let fresh = 0
  const word = () => `${side}${(fresh += 1)}`
  for (const change of edits) {
    if (change.kind === 'insert') {
      blocks.splice(Math.min(change.at, blocks.length), 0, [word(), word()])
      continue
    }
    if (blocks.length === 0) continue
    const block =
      change.kind === 'move' ? change.from % blocks.length : change.block % blocks.length
    const target = blocks[block] ?? []
    if (change.kind === 'reword') target[change.word % target.length] = word()
    else if (change.kind === 'delete') blocks.splice(block, 1)
    else {
      blocks.splice(block, 1)
      blocks.splice(Math.min(change.to, blocks.length), 0, target)
    }
  }
  return blocks
}

const markdownFor = (paragraphs: Paragraphs): string =>
  paragraphs.map((words) => `${words.join(' ')}\n`).join('\n')

const treeFor = (paragraphs: Paragraphs): Root => parseMarkdown(markdownFor(paragraphs))

const wordsIn = (blocks: readonly RootContent[]): Set<string> =>
  new Set(
    stringifyMdast({ type: 'root', children: [...blocks] })
      .split(/\s+/u)
      .filter(Boolean),
  )

function conflictWords(result: DocumentMerge, side: 'base' | 'mine' | 'theirs'): Set<string> {
  return wordsIn(result.conflicts.flatMap((conflict) => conflict[side]))
}

const scenario = fc.record({
  base: baseArbitrary,
  mine: fc.array(editArbitrary, { maxLength: 4 }),
  theirs: fc.array(editArbitrary, { maxLength: 4 }),
})

const RUNS = { numRuns: 400 }
const BLANK_LINE = /\n\n/u

describe('mergeDocuments: properties', () => {
  it('is the identity where a side changed nothing', () => {
    fc.assert(
      fc.property(scenario, ({ base, theirs }) => {
        const changed = treeFor(edit(base, theirs, 't'))
        expect(contentKey(mergeDocuments(treeFor(base), treeFor(base), changed).merged)).toBe(
          contentKey(changed),
        )
        expect(contentKey(mergeDocuments(treeFor(base), changed, treeFor(base)).merged)).toBe(
          contentKey(changed),
        )
      }),
      RUNS,
    )
  })

  it('is symmetric, up to which side is which', () => {
    fc.assert(
      fc.property(scenario, ({ base, mine, theirs }) => {
        const [o, a, b] = [
          treeFor(base),
          treeFor(edit(base, mine, 'm')),
          treeFor(edit(base, theirs, 't')),
        ]
        const forward = mergeDocuments(o, a, b)
        const backward = mergeDocuments(o, b, a)
        expect(forward.merged.children.map(contentKey)).toEqual(
          backward.merged.children.map(contentKey),
        )
        expect(
          forward.conflicts.map(({ index, base: from, mine: ours, theirs: other }) =>
            [index, from, ours, other].map(keysOf),
          ),
        ).toEqual(
          backward.conflicts.map(({ index, base: from, mine: ours, theirs: other }) =>
            [index, from, other, ours].map(keysOf),
          ),
        )
      }),
      RUNS,
    )
  })

  it('writes every block whose content came through unchanged exactly as it was', () => {
    fc.assert(
      fc.property(scenario, ({ base, mine, theirs }) => {
        const [ours, other] = [edit(base, mine, 'm'), edit(base, theirs, 't')]
        const result = mergeDocuments(treeFor(base), treeFor(ours), treeFor(other))
        const written = stringifyMdast(result.merged)
          .split(BLANK_LINE)
          .map((block) => block.trim())
        const lines = new Set(base.map((words) => words.join(' ')))
        const kept = result.merged.children
          .map((block) => stringifyMdast({ type: 'root', children: [block] }).trim())
          .filter((line) => lines.has(line))
        for (const line of kept) expect(written).toContain(line)
      }),
      RUNS,
    )
  })

  it('never loses a change: every edit is merged, or is in a conflict', () => {
    fc.assert(
      fc.property(scenario, ({ base, mine, theirs }) => {
        const [ours, other] = [edit(base, mine, 'm'), edit(base, theirs, 't')]
        const result = mergeDocuments(treeFor(base), treeFor(ours), treeFor(other))
        const merged = wordsIn(result.merged.children)
        const inBase = new Set(base.flat())
        const inMine = new Set(ours.flat())
        const inTheirs = new Set(other.flat())
        const conflicted = {
          base: conflictWords(result, 'base'),
          mine: conflictWords(result, 'mine'),
          theirs: conflictWords(result, 'theirs'),
        }
        const lost = [
          // What a side wrote is in the result, or offered in a conflict.
          ...[...inMine].filter(
            (word) => !inBase.has(word) && !merged.has(word) && !conflicted.mine.has(word),
          ),
          ...[...inTheirs].filter(
            (word) => !inBase.has(word) && !merged.has(word) && !conflicted.theirs.has(word),
          ),
          // What a side removed stays removed, unless the removal is in a conflict.
          ...[...inBase].filter(
            (word) =>
              (!inMine.has(word) || !inTheirs.has(word)) &&
              merged.has(word) &&
              !conflicted.base.has(word),
          ),
        ]
        expect(lost).toEqual([])
      }),
      RUNS,
    )
  })
})

function keysOf(value: number | readonly RootContent[]): unknown {
  return typeof value === 'number' ? value : value.map(contentKey)
}
