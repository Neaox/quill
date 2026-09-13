import { describe, expect, it } from 'vitest'

import type { DocumentDto } from '../api/index.ts'
import { groupDocumentsByCollection } from './group-by-collection.ts'

function document(overrides: Partial<DocumentDto>): DocumentDto {
  return {
    id: 'doc',
    shortId: 'k7m3q9v2rt',
    workspaceId: 'workspace',
    collectionId: null,
    parentId: null,
    slug: 'doc',
    path: '/doc',
    title: 'Doc',
    status: 'draft',
    templateId: null,
    templateVersion: null,
    headRevision: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('groupDocumentsByCollection', () => {
  it('returns no groups for an empty document list', () => {
    expect(groupDocumentsByCollection([])).toEqual([])
  })

  it('sorts named groups alphabetically by collection id', () => {
    const groups = groupDocumentsByCollection([
      document({ id: 'a', collectionId: 'zebra' }),
      document({ id: 'b', collectionId: 'alpha' }),
    ])
    expect(groups.map((group) => group.collectionId)).toEqual(['alpha', 'zebra'])
  })

  it('puts documents with no collection into a trailing "Uncategorised" group', () => {
    const groups = groupDocumentsByCollection([
      document({ id: 'a', collectionId: 'guides' }),
      document({ id: 'b', collectionId: null }),
    ])
    expect(groups.map((group) => group.label)).toEqual(['guides', 'Uncategorised'])
    expect(groups.at(-1)?.collectionId).toBeNull()
  })

  it('omits the "Uncategorised" group entirely when every document has a collection', () => {
    const groups = groupDocumentsByCollection([document({ id: 'a', collectionId: 'guides' })])
    expect(groups.map((group) => group.label)).toEqual(['guides'])
  })
})
