import { describe, expect, it } from 'vitest'

import { groupByDay } from './group-by-day.ts'

const at = (iso: string) => new Date(iso).getTime()

// Local-time dates (no `Z`), so the test holds in any time zone.
const NOW = at('2026-10-13T15:00:00')

const item = (id: string, updatedAt: string) => ({ id, updatedAt })

describe('groupByDay', () => {
  it('names the recent days and dates the rest, keeping the order it was given', () => {
    const groups = groupByDay(
      [
        item('a', '2026-10-13T09:00:00'),
        item('b', '2026-10-13T01:00:00'),
        item('c', '2026-10-12T23:00:00'),
        item('d', '2026-10-09T10:00:00'),
        item('e', '2026-09-20T10:00:00'),
        item('f', '2025-12-31T10:00:00'),
      ],
      (row) => row.updatedAt,
      NOW,
      'en-GB',
    )

    expect(groups.map((group) => [group.label, group.items.map((row) => row.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['Friday', ['d']],
      ['20 September', ['e']],
      ['31 December 2025', ['f']],
    ])
  })

  it('has no groups for nothing', () => {
    expect(groupByDay([], () => '', NOW)).toEqual([])
  })
})
