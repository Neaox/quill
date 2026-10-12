import { describe, expect, it } from 'vitest'

import type { TreeCollectionDto } from '../api/index.ts'
import { childDocumentsOf, findTreeNode, toTreeNode } from './tree-nodes.ts'

type Node = TreeCollectionDto['documents'][number]

function node(id: string, title: string, children: Node[] = []): Node {
  return { id, shortId: `${id}`.padEnd(10, '0'), title, slug: id, status: 'published', children }
}

const COLLECTIONS: readonly TreeCollectionDto[] = [
  {
    id: 'c1',
    name: 'Engineering',
    slug: 'engineering',
    documents: [
      node('a', 'Architecture', [
        node('a1', 'Overview', [node('a1x', 'Diagrams')]),
        node('a2', 'Decisions'),
      ]),
      node('b', 'Runbooks'),
    ],
  },
  {
    id: 'c2',
    name: 'Product',
    slug: 'product',
    documents: [node('p', 'Specs', [node('p1', 'Search')])],
  },
]

describe('turning the tree the server sends into the tree the design system draws', () => {
  it('gives a document its title, its address and what is beneath it', () => {
    const drawn = toTreeNode('acme', node('a1', 'Overview', [node('a1x', 'Diagrams')]))
    expect(drawn.label).toBe('Overview')
    expect(drawn.link).toEqual({
      to: '/w/$workspaceSlug/d/$documentId',
      params: { workspaceSlug: 'acme', documentId: 'overview-a100000000' },
      search: {},
    })
    expect(drawn.children?.map((child) => child.label)).toEqual(['Diagrams'])
  })
})

describe('finding a document in the tree', () => {
  it('finds it at any depth, in any collection', () => {
    expect(findTreeNode(COLLECTIONS, 'a')?.title).toBe('Architecture')
    expect(findTreeNode(COLLECTIONS, 'a1x')?.title).toBe('Diagrams')
    expect(findTreeNode(COLLECTIONS, 'p1')?.title).toBe('Search')
  })

  it('says so when it is not there', () => {
    expect(findTreeNode(COLLECTIONS, 'nope')).toBeUndefined()
    expect(findTreeNode([], 'a')).toBeUndefined()
  })
})

describe('the documents beneath a document', () => {
  it('lists its children, with theirs beneath them, all the way down', () => {
    const children = childDocumentsOf(COLLECTIONS, 'a', 'acme')
    expect(children.map((child) => child.label)).toEqual(['Overview', 'Decisions'])
    expect(children[0]?.children?.map((child) => child.label)).toEqual(['Diagrams'])
  })

  it('is empty for a document with none, and for one that is not in the tree', () => {
    expect(childDocumentsOf(COLLECTIONS, 'b', 'acme')).toEqual([])
    expect(childDocumentsOf(COLLECTIONS, 'nope', 'acme')).toEqual([])
  })
})
