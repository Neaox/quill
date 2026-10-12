import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { changeRuns, diffText, tokenize, wordCount } from './runs.ts'

function show(before: string, after: string): string {
  return diffText(before, after)
    .segments.map((segment) =>
      segment.change === 'equal'
        ? segment.text
        : segment.change === 'added'
          ? `{+${segment.text}}`
          : `{-${segment.text}}`,
    )
    .join('')
}

describe('tokenize', () => {
  it('keeps words, spaces and punctuation apart, and loses nothing', () => {
    expect(tokenize('Hello, wide world.')).toEqual(['Hello', ',', ' ', 'wide', ' ', 'world', '.'])
    expect(tokenize("don't stop")).toEqual(["don't", ' ', 'stop'])
  })

  it('counts words, not punctuation or spaces', () => {
    expect(wordCount(tokenize('One, two  three.'))).toBe(3)
  })

  it('round-trips any text', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(tokenize(text).join('')).toBe(text)
      }),
    )
  })
})

describe('diffText', () => {
  it('marks a replaced word as removed then added', () => {
    expect(show('the quick fox', 'the slow fox')).toBe('the {-quick}{+slow} fox')
  })

  it('reads a rewritten phrase as one change rather than a word salad', () => {
    expect(show('a quick brown fox', 'a slow red fox')).toBe('a {-quick brown}{+slow red} fox')
  })

  it('counts the words each side gained and lost', () => {
    const diff = diffText('Ship it on Monday.', 'Ship it on Tuesday after review.')
    expect(diff.added).toBe(3)
    expect(diff.removed).toBe(1)
  })

  it('says nothing changed between equal texts', () => {
    const diff = diffText('Same words.', 'Same words.')
    expect(diff.segments).toEqual([{ change: 'equal', text: 'Same words.' }])
    expect(diff.added + diff.removed).toBe(0)
  })

  it('always rebuilds both sides exactly', () => {
    fc.assert(
      fc.property(fc.lorem({ maxCount: 12 }), fc.lorem({ maxCount: 12 }), (before, after) => {
        const { segments } = diffText(before, after)
        const side = (skip: string) =>
          segments
            .filter((segment) => segment.change !== skip)
            .map((segment) => segment.text)
            .join('')
        expect(side('added')).toBe(before)
        expect(side('removed')).toBe(after)
      }),
    )
  })
})

describe('changeRuns', () => {
  it('groups any items, not only words', () => {
    const runs = changeRuns(['a', 'b', 'c'], ['a', 'c', 'd'], (item) => item)
    expect(runs.map((run) => [run.change, run.items.join('')])).toEqual([
      ['equal', 'a'],
      ['removed', 'b'],
      ['equal', 'c'],
      ['added', 'd'],
    ])
  })
})
