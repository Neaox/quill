import { describe, expect, it } from 'vitest'

import type { Comparison } from '../../lib/api/types.ts'
import { describeChanges, othersChanges } from './publish-changes.ts'

const NONE: Comparison = {
  html: '',
  summary: {
    sections: 0,
    added: 0,
    removed: 0,
    changed: 0,
    moved: 0,
    wordsAdded: 0,
    wordsRemoved: 0,
  },
  changes: [],
  sections: [],
  properties: [],
}

function comparison(overrides: Partial<Comparison>): Comparison {
  return { ...NONE, ...overrides }
}

const change = (
  kind: 'added' | 'removed' | 'changed' | 'moved',
  excerpt: string,
  section?: string,
): Comparison['changes'][number] => ({
  id: `c-${excerpt}`,
  change: kind,
  block: 'paragraph',
  excerpt,
  wordsAdded: 0,
  wordsRemoved: 0,
  ...(section === undefined ? {} : { section: { id: section.toLowerCase(), title: section } }),
})

describe('what is waiting to be published', () => {
  it('is nothing when nothing differs, in the blocks or in the properties', () => {
    const described = describeChanges(NONE)

    expect(described.empty).toBe(true)
    expect(described.headline).toBe('Nothing to publish')
    expect(described.items).toEqual([])
  })

  it('counts what was added, changed, removed and moved, in that order, saying each once', () => {
    const described = describeChanges(
      comparison({
        summary: { ...NONE.summary, added: 1, changed: 2, removed: 1, moved: 1 },
        changes: [change('added', 'A'), change('changed', 'B'), change('changed', 'C')],
      }),
    )

    expect(described.empty).toBe(false)
    expect(described.headline).toBe(
      '1 block added, 2 blocks changed, 1 block removed, 1 block moved',
    )
  })

  it('says how many words, when there are some', () => {
    const described = describeChanges(
      comparison({
        summary: { ...NONE.summary, changed: 1, wordsAdded: 42, wordsRemoved: 5 },
        changes: [change('changed', 'B')],
      }),
    )

    expect(described.words).toBe('+42 words, −5 words')
    expect(described.headline).toBe('1 block changed')
  })

  it('says one word in the singular, and nothing of a side with none', () => {
    const one = describeChanges(
      comparison({
        summary: { ...NONE.summary, changed: 1, wordsAdded: 1 },
        changes: [change('changed', 'B')],
      }),
    )

    expect(one.words).toBe('+1 word')
    expect(describeChanges(NONE).words).toBe('')
  })

  it('lists the first few changes with where they are, and how many more there were', () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      change('changed', `Line ${String(index)}`, index < 4 ? 'Steps' : undefined),
    )
    const described = describeChanges(
      comparison({ summary: { ...NONE.summary, changed: 8 }, changes: many }),
    )

    expect(described.items).toHaveLength(5)
    expect(described.items[0]).toMatchObject({
      id: 'c-Line 0',
      kind: 'Changed',
      where: 'Steps',
      excerpt: 'Line 0',
    })
    expect(described.items[4]).toMatchObject({
      kind: 'Changed',
      where: 'The start',
      excerpt: 'Line 4',
    })
    expect(described.more).toBe(3)
  })

  it('counts a changed property as something to publish', () => {
    const described = describeChanges(
      comparison({ properties: [{ name: 'owner', before: 'Ada', after: 'Grace' }] }),
    )

    expect(described.empty).toBe(false)
    expect(described.headline).toBe('1 property changed')
    expect(described.items).toEqual([{ kind: 'Property', where: 'owner', excerpt: 'Ada → Grace' }])
  })

  it('reads out as one sentence, for somebody who cannot see the panel', () => {
    const described = describeChanges(
      comparison({
        summary: { ...NONE.summary, changed: 1, wordsAdded: 3 },
        changes: [change('changed', 'The queue', 'Steps')],
      }),
    )

    expect(described.text).toBe('1 block changed, +3 words. Changed in Steps: The queue.')
  })
})

const authored = (
  excerpt: string,
  author: { id: string; name?: string; at: string } | undefined,
): Comparison['changes'][number] => ({
  ...change('changed', excerpt),
  ...(author === undefined ? {} : { author }),
})

describe('who made what is waiting', () => {
  const at = '2026-01-02T10:00:00.000Z'

  it('says who made each change in the panel and in the sentence for a screen reader', () => {
    const described = describeChanges(
      comparison({
        summary: { ...NONE.summary, changed: 1, sections: 1 },
        changes: [authored('The queue.', { id: 'u2', name: 'Grace', at })],
      }),
    )

    expect(described.items[0]).toMatchObject({ by: 'Grace' })
    expect(described.text).toContain('Changed in The start by Grace: The queue.')
  })

  it('leaves a change whose author is not known without one', () => {
    const described = describeChanges(
      comparison({
        summary: { ...NONE.summary, changed: 1, sections: 1 },
        changes: [authored('The queue.', undefined)],
      }),
    )

    expect(described.items[0]).not.toHaveProperty('by')
    expect(described.text).toContain('Changed in The start: The queue.')
  })

  it('lists the other people whose changes would go out, with how many each', () => {
    const others = othersChanges(
      comparison({
        changes: [
          authored('One.', { id: 'me', name: 'Ada', at }),
          authored('Two.', { id: 'u2', name: 'Grace', at }),
          authored('Three.', { id: 'u2', name: 'Grace', at }),
          authored('Four.', { id: 'u3', at }),
          authored('Five.', undefined),
        ],
      }),
      'me',
    )

    expect(others).toEqual([
      { id: 'u2', name: 'Grace', changes: 2 },
      { id: 'u3', name: 'Someone', changes: 1 },
    ])
  })

  it('lists no one when every change is the reader’s own, or none is known', () => {
    expect(
      othersChanges(comparison({ changes: [authored('One.', { id: 'me', at })] }), 'me'),
    ).toEqual([])
    expect(othersChanges(comparison({ changes: [authored('One.', undefined)] }), 'me')).toEqual([])
  })
})
