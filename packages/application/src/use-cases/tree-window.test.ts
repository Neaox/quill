import { describe, expect, it } from 'vitest'
import { documentId, type DocumentId } from '@quill/domain'

import type { CollectionId } from '../ports/persistence.ts'
import type { CollectionTree, TreeNode } from './get-workspace-tree.ts'
import { childrenPage, windowTree, type WindowedNode } from './tree-window.ts'
import { aShortId } from '../test-support/fakes.ts'

let next = 0
function node(title: string, children: readonly TreeNode[] = []): TreeNode {
  next += 1
  return {
    id: documentId(`00000000-0000-4000-8000-${String(next).padStart(12, '0')}`),
    shortId: aShortId(),
    title,
    slug: title.toLowerCase().replaceAll(' ', '-'),
    status: 'published',
    children,
  }
}

function collection(name: string, documents: readonly TreeNode[]): CollectionTree {
  return { id: `col-${name}` as CollectionId, name, slug: name, documents }
}

const titles = (nodes: readonly WindowedNode[]): unknown =>
  nodes.map((entry) =>
    entry.children.length === 0 ? entry.title : { [entry.title]: titles(entry.children) },
  )

/** A collection with 120 siblings, a chain four deep at position 90. */
function stress(): { readonly tree: CollectionTree; readonly deepest: DocumentId } {
  const deepest = node('Deep 4', [node('Under deep 4')])
  const chain = node('Deep 1', [node('Deep 2', [node('Deep 3', [deepest, node('Beside 4')])])])
  const siblings = Array.from({ length: 120 }, (_, index) => node(`Entry ${index + 1}`))
  siblings.splice(90, 0, chain)
  return { tree: collection('stress', siblings), deepest: deepest.id }
}

describe('windowTree', () => {
  it('cuts the tree to a depth and a page, and says how much there is', () => {
    const { tree } = stress()
    const [windowed] = windowTree([tree], { depth: 1, limit: 50 })

    expect(windowed?.documents).toHaveLength(50)
    expect(windowed?.documentCount).toBe(121)
    expect(windowed?.documentsOffset).toBe(0)
    // Every document, nesting included, for the section's count.
    expect(windowed?.total).toBe(121 + 5)
    const chain = windowTree([tree], { depth: 1, limit: 200 })[0]?.documents[90]
    expect(chain?.title).toBe('Deep 1')
    expect(chain?.childCount).toBe(1)
    expect(chain?.children).toEqual([])
  })

  it('brings the way to a focused document in the first response, a page at each level', () => {
    const { tree, deepest } = stress()
    const [windowed] = windowTree([tree], { depth: 1, limit: 50, focus: deepest })

    // The page holding the chain, not the first page.
    expect(windowed?.documentsOffset).toBe(50)
    const chain = windowed?.documents.find((entry) => entry.title === 'Deep 1')
    expect(chain === undefined ? undefined : titles([chain])).toEqual([
      { 'Deep 1': [{ 'Deep 2': [{ 'Deep 3': [{ 'Deep 4': ['Under deep 4'] }, 'Beside 4'] }] }] },
    ])
  })

  it('leaves the tree whole when no depth is asked for', () => {
    const { tree } = stress()
    const [windowed] = windowTree([tree], { limit: Number.POSITIVE_INFINITY })

    expect(windowed?.documents).toHaveLength(121)
    expect(windowed?.documents[90]?.children[0]?.children[0]?.title).toBe('Deep 3')
  })
})

describe('childrenPage', () => {
  it('pages a collection’s top level', () => {
    const { tree } = stress()
    const page = childrenPage(
      [tree],
      { kind: 'collection', collectionId: tree.id },
      { offset: 100, limit: 50 },
    )

    expect(page).toMatchObject({ kind: 'page', total: 121, offset: 100 })
    expect(page.kind === 'page' ? page.documents.map((entry) => entry.title) : []).toHaveLength(21)
  })

  it('pages a document’s children, each with its own count and none of its own children', () => {
    const { tree, deepest } = stress()
    const deep3 = tree.documents[90]?.children[0]?.children[0]
    const page = childrenPage(
      [tree],
      {
        kind: 'document',
        parentId: deep3?.id ?? documentId('00000000-0000-4000-8000-ffffffffffff'),
      },
      { offset: 0, limit: 50 },
    )

    expect(page.kind === 'page' ? page.documents : []).toEqual([
      expect.objectContaining({ id: deepest, childCount: 1, children: [] }),
      expect.objectContaining({ title: 'Beside 4', childCount: 0, children: [] }),
    ])
  })

  it('answers not found for a parent the reader cannot see or that does not exist', () => {
    const { tree } = stress()
    expect(
      childrenPage(
        [tree],
        { kind: 'document', parentId: documentId('00000000-0000-4000-8000-ffffffffffff') },
        {
          offset: 0,
          limit: 50,
        },
      ).kind,
    ).toBe('not-found')
    expect(
      childrenPage(
        [tree],
        { kind: 'collection', collectionId: 'col-missing' as CollectionId },
        { offset: 0, limit: 50 },
      ).kind,
    ).toBe('not-found')
  })
})
