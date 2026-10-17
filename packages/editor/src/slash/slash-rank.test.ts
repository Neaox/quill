import { describe, expect, it } from 'vitest'

import { highlight, rankMatches } from './slash-rank.ts'
import type { Rankable } from './slash-rank.ts'

const ITEMS: readonly Rankable[] = [
  { label: 'Status badge', keywords: ['pill'] },
  { label: 'Table', keywords: ['grid'] },
  { label: 'Bulleted list', aliases: ['ul'] },
  { label: 'Callout: Warning', keywords: ['admonition'] },
  { label: 'Heading 2', aliases: ['h2'] },
  { label: 'Task list' },
]

function labels(query: string, items: readonly Rankable[] = ITEMS): readonly string[] {
  return rankMatches(query, items).map(({ item }) => item.label)
}

describe('ranking what the author typed', () => {
  it('lists everything, in order, for an empty query', () => {
    expect(labels('')).toEqual(ITEMS.map((item) => item.label))
    expect(labels('   ')).toHaveLength(ITEMS.length)
  })

  it('puts a label prefix first, then word starts, then keywords, then letters in order', () => {
    // `ta`: Table and Task list by prefix; Status badge has the letters, but
    // not from the start of a word.
    expect(labels('ta')).toEqual(['Table', 'Task list'])
    // `sbad`: letters in order from a word's start.
    expect(labels('sbad')).toEqual(['Status badge'])
    // `list`: a word start in two labels.
    expect(labels('list')).toEqual(['Bulleted list', 'Task list'])
    // `gri`: Table's keyword.
    expect(labels('gri')).toEqual(['Table'])
    // `bllst`: only letters in order.
    expect(labels('bllst')).toEqual(['Bulleted list'])
  })

  it('takes an exact alias as a best match, and an alias prefix as a keyword', () => {
    expect(labels('h2')[0]).toBe('Heading 2')
    expect(labels('u')).toEqual(['Bulleted list'])
  })

  it('matches several words against the words of a label, in order', () => {
    expect(labels('call warn')).toEqual(['Callout: Warning'])
    expect(labels('warn call')).toEqual([])
  })

  it('needs two letters before it matches letters scattered through a label', () => {
    expect(labels('z')).toEqual([])
    expect(labels('q')).toEqual([])
  })

  it('ignores case and repeated spaces', () => {
    expect(labels('CALL   WARN')).toEqual(['Callout: Warning'])
  })

  it('says which characters matched', () => {
    const [prefix] = rankMatches('tab', ITEMS)
    expect(prefix?.ranges).toEqual([{ start: 0, end: 3 }])
    const [words] = rankMatches('call warn', ITEMS)
    expect(words?.ranges).toEqual([
      { start: 0, end: 4 },
      { start: 9, end: 13 },
    ])
    const [letters] = rankMatches('bllst', ITEMS)
    expect(letters?.ranges).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 4 },
      { start: 11, end: 13 },
    ])
    const [keyword] = rankMatches('grid', ITEMS)
    expect(keyword?.ranges).toEqual([])
  })

  it('ranks a hundred items in well under a frame', () => {
    const many = Array.from({ length: 100 }, (_, index) => ({
      label: `Block number ${String(index)}`,
      keywords: ['block', `kind-${String(index % 7)}`],
    }))
    rankMatches('blk', many)
    const started = performance.now()
    for (const query of ['b', 'bl', 'blo', 'block n', 'kind-3', 'nmbr']) rankMatches(query, many)
    expect((performance.now() - started) / 6).toBeLessThan(16)
  })
})

describe('highlighting a label', () => {
  it('splits it into matched and unmatched runs', () => {
    expect(highlight('Table', [{ start: 0, end: 3 }])).toEqual([
      { text: 'Tab', matched: true, start: 0 },
      { text: 'le', matched: false, start: 3 },
    ])
    expect(highlight('Task list', [{ start: 5, end: 9 }])).toEqual([
      { text: 'Task ', matched: false, start: 0 },
      { text: 'list', matched: true, start: 5 },
    ])
    expect(highlight('Table', [])).toEqual([{ text: 'Table', matched: false, start: 0 }])
  })
})
