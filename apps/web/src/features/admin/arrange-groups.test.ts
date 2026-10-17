import { describe, expect, it } from 'vitest'

import type { GroupSummaryDto } from '../../lib/api/index.ts'
import { arrangeGroups } from './arrange-groups.ts'

const group = (
  id: string,
  name: string,
  unitPath = 'Acme',
  parentGroupId: string | null = null,
): GroupSummaryDto => ({
  id,
  name,
  unitId: `unit:${unitPath}`,
  unitPath,
  parentGroupId,
  memberCount: 0,
})

describe('arrangeGroups', () => {
  it('sections groups by unit, in the order the server listed the units', () => {
    const sections = arrangeGroups([
      group('a', 'Design', 'Acme'),
      group('b', 'Oncall', 'Acme / Platform'),
      group('c', 'Finance', 'Acme'),
    ])

    expect(
      sections.map((section) => [section.unitPath, section.rows.map((row) => row.group.id)]),
    ).toEqual([
      ['Acme', ['a', 'c']],
      ['Acme / Platform', ['b']],
    ])
  })

  it('puts a nested group under its parent, one level in, however the list was ordered', () => {
    const [section] = arrangeGroups([
      group('child', 'Platform', 'Acme', 'parent'),
      group('parent', 'Engineering'),
      group('grandchild', 'Oncall', 'Acme', 'child'),
      group('other', 'Zeta'),
    ])

    expect(section?.rows.map((row) => [row.group.id, row.depth])).toEqual([
      ['parent', 0],
      ['child', 1],
      ['grandchild', 2],
      ['other', 0],
    ])
  })

  it('keeps a group whose parent is not in the list rather than losing it', () => {
    const [section] = arrangeGroups([group('lost', 'Lost', 'Acme', 'gone')])
    expect(section?.rows.map((row) => [row.group.id, row.depth])).toEqual([['lost', 0]])
  })

  it('says nothing for no groups', () => {
    expect(arrangeGroups([])).toEqual([])
  })
})
