import { describe, expect, it } from 'vitest'

import type { SourceLine } from '../../../lib/api/index.ts'
import { foldSource, sideBySide } from './source-hunks.ts'

function equal(n: number): SourceLine {
  return {
    change: 'equal',
    before: n,
    after: n,
    segments: [{ change: 'equal', text: `line ${n}` }],
  }
}
const removed = (n: number): SourceLine => ({
  change: 'removed',
  before: n,
  segments: [{ change: 'removed', text: `old ${n}` }],
})
const added = (n: number): SourceLine => ({
  change: 'added',
  after: n,
  segments: [{ change: 'added', text: `new ${n}` }],
})

describe('foldSource', () => {
  it('keeps three lines of context around each change and folds the rest', () => {
    const lines = [
      ...Array.from({ length: 10 }, (_, i) => equal(i + 1)),
      removed(11),
      added(11),
      ...Array.from({ length: 10 }, (_, i) => equal(i + 12)),
    ]
    const parts = foldSource(lines)
    expect(parts.map((part) => [part.kind, part.lines.length])).toEqual([
      ['gap', 7],
      ['hunk', 8],
      ['gap', 7],
    ])
  })

  it('does not fold a stretch too short to be worth a button', () => {
    const lines = [removed(1), ...Array.from({ length: 7 }, (_, i) => equal(i + 2)), added(9)]
    expect(foldSource(lines).map((part) => part.kind)).toEqual(['hunk'])
  })

  it('folds a document with no changes into one stretch', () => {
    expect(foldSource([equal(1), equal(2)]).map((part) => part.kind)).toEqual(['gap'])
  })
})

describe('sideBySide', () => {
  it('pairs each removed line with the added line that replaced it', () => {
    const rows = sideBySide([equal(1), removed(2), removed(3), added(2), equal(4)])
    expect(rows.map((row) => [row.before?.change, row.after?.change])).toEqual([
      ['equal', 'equal'],
      ['removed', 'added'],
      ['removed', undefined],
      ['equal', 'equal'],
    ])
  })
})
