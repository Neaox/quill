import { describe, expect, it } from 'vitest'

import {
  fromTreeResponse,
  listKey,
  mergeList,
  mergeTree,
  withPage,
  type NavigationList,
} from './navigation-tree.ts'
import type { WorkspaceTreeResponse } from './types.ts'

type ResponseNode = WorkspaceTreeResponse['collections'][number]['documents'][number]

function node(id: string, extra: Partial<ResponseNode> = {}): ResponseNode {
  return {
    id,
    shortId: `${id.padEnd(10, '0').slice(0, 10)}`,
    title: id,
    slug: id,
    status: 'published',
    children: [],
    childCount: 0,
    childrenOffset: 0,
    ...extra,
  }
}

const RESPONSE: WorkspaceTreeResponse = {
  collections: [
    {
      id: 'guides',
      name: 'Guides',
      slug: 'guides',
      documentCount: 120,
      documentsOffset: 50,
      total: 130,
      documents: [
        node('a', { childCount: 2, children: [node('a1')] }),
        node('b', { childCount: 4, children: [] }),
      ],
    },
  ],
}

describe('fromTreeResponse', () => {
  it('keeps each list as the slice it is, with its total, and every node once', () => {
    const tree = fromTreeResponse(RESPONSE)

    expect(tree.collections).toEqual([{ id: 'guides', name: 'Guides', slug: 'guides', total: 130 }])
    expect(tree.lists.get(listKey.collection('guides'))).toEqual({
      offset: 50,
      total: 120,
      ids: ['a', 'b'],
    })
    expect(tree.lists.get(listKey.document('a'))).toEqual({ offset: 0, total: 2, ids: ['a1'] })
    // Children counted but not sent are not a loaded list.
    expect(tree.lists.has(listKey.document('b'))).toBe(false)
    expect(tree.nodes.get('b')?.childCount).toBe(4)
  })

  it('reads the whole-tree shape, which carries no counts, as complete lists', () => {
    const tree = fromTreeResponse({
      collections: [
        {
          id: 'guides',
          name: 'Guides',
          slug: 'guides',
          documents: [{ ...node('a'), children: [node('a1')] }].map(
            ({ childCount: _count, childrenOffset: _offset, ...rest }) => rest,
          ),
        },
      ],
    })

    expect(tree.lists.get(listKey.collection('guides'))).toEqual({
      offset: 0,
      total: 1,
      ids: ['a'],
    })
    expect(tree.nodes.get('a')?.childCount).toBe(1)
  })
})

const list = (offset: number, ids: readonly string[], total = 200): NavigationList => ({
  offset,
  total,
  ids,
})

describe('mergeList', () => {
  it('joins slices that touch or overlap into one', () => {
    expect(mergeList(list(0, ['a', 'b']), list(2, ['c']))).toEqual(list(0, ['a', 'b', 'c']))
    expect(mergeList(list(2, ['c', 'd']), list(0, ['a', 'b', 'c']))).toEqual(
      list(0, ['a', 'b', 'c', 'd']),
    )
  })

  it('takes the new slice when the two are apart, since it is the one wanted now', () => {
    expect(mergeList(list(0, ['a']), list(100, ['z']))).toEqual(list(100, ['z']))
  })
})

describe('mergeTree and withPage', () => {
  it('adds what a later response or page brings, and keeps what was there', () => {
    const base = fromTreeResponse(RESPONSE)
    const paged = withPage(base, listKey.document('b'), {
      offset: 0,
      total: 4,
      documents: [node('b1'), node('b2')],
    })
    expect(paged.lists.get(listKey.document('b'))?.ids).toEqual(['b1', 'b2'])
    expect(paged.nodes.has('b2')).toBe(true)

    const merged = mergeTree(paged, {
      collections: [
        {
          ...RESPONSE.collections[0]!,
          documentsOffset: 52,
          documents: [node('c')],
        },
      ],
    })
    expect(merged.lists.get(listKey.collection('guides'))?.ids).toEqual(['a', 'b', 'c'])
    expect(merged.lists.get(listKey.document('b'))?.ids).toEqual(['b1', 'b2'])
  })
})
