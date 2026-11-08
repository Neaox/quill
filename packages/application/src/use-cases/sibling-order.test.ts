import { describe, expect, it } from 'vitest'
import { documentId } from '@quill/domain'

import { compareSiblings, compareSortKeys } from './sibling-order.ts'
import type { SiblingOrdered } from './sibling-order.ts'

const sibling = (n: number, sortKey: number | null, createdAt: string): SiblingOrdered => ({
  id: documentId(`00000000-0000-4000-8000-00000000000${n}`),
  sortKey,
  createdAt: new Date(createdAt),
})

describe('compareSiblings', () => {
  it('orders by key, keyless last, then oldest first, then by id', () => {
    const siblings = [
      sibling(1, null, '2026-01-02'),
      sibling(2, 5, '2026-01-09'),
      sibling(3, null, '2026-01-01'),
      sibling(4, 1, '2026-01-09'),
      sibling(6, null, '2026-01-01'),
      sibling(5, null, '2026-01-01'),
    ]
    expect(siblings.toSorted(compareSiblings).map(({ id }) => id.slice(-1))).toEqual([
      '4',
      '2',
      '3',
      '5',
      '6',
      '1',
    ])
  })

  it('ties two documents with no key on their keys alone', () => {
    expect(
      compareSortKeys(sibling(1, null, '2026-01-01'), sibling(2, null, '2026-01-02')),
    ).toBeNaN()
  })
})
