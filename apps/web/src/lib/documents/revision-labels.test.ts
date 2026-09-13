import { describe, expect, it } from 'vitest'

import { labelRevisions, revisionDate, shortRevision } from './revision-labels.ts'
import type { RevisionSummary } from '../api/index.ts'

function revision(id: string, timestamp: string): RevisionSummary {
  return {
    revision: id,
    author: { name: 'Ada', email: 'ada@example.com' },
    timestamp,
    summary: 'Wrote something',
  }
}

describe('labelRevisions', () => {
  it('counts versions down from the newest when the whole history is known', () => {
    const labelled = labelRevisions(
      [
        revision('c'.repeat(40), '2026-03-01T10:00:00.000Z'),
        revision('b'.repeat(40), '2026-02-01T10:00:00.000Z'),
        revision('a'.repeat(40), '2026-01-01T10:00:00.000Z'),
      ],
      { complete: true },
    )

    expect(labelled.map((entry) => entry.label)).toEqual(['v3', 'v2', 'v1'])
    expect(labelled.map((entry) => entry.date)).toEqual(['2026-03-01', '2026-02-01', '2026-01-01'])
  })

  it('falls back to the short hash when the history is only a page of itself', () => {
    const labelled = labelRevisions([revision('abcdef1234567890'.padEnd(40, '0'), '2026-03-01')], {
      complete: false,
    })

    expect(labelled[0]?.label).toBe('abcdef1')
  })

  it('carries the author and the change note through', () => {
    const [labelled] = labelRevisions(
      [{ ...revision('a'.repeat(40), '2026-01-01'), changeNote: 'Restored v1' }],
      { complete: true },
    )

    expect(labelled?.authorName).toBe('Ada')
    expect(labelled?.changeNote).toBe('Restored v1')
  })
})

describe('shortRevision and revisionDate', () => {
  it('shortens a revision to the part a person reads', () => {
    expect(shortRevision('0123456789abcdef')).toBe('0123456')
  })

  it('takes the date out of an ISO timestamp', () => {
    expect(revisionDate('2026-08-15T09:30:00.000Z')).toBe('2026-08-15')
  })
})
