import type { CollectionRow, DocumentRow, WorkspaceRow } from '@quill/application'
import type { SearchServiceHit, SearchServiceResults } from '@quill/search'
import { collectionId, documentId, workspaceId } from '@quill/domain'
import type { CollectionId, DocumentId, ShortId, WorkspaceId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import { toSearchResponse } from './search-response.ts'
import type { SearchContext } from './search-response.ts'

const ENGINEERING = workspaceId('11111111-1111-4111-8111-111111111111')
const MARKETING = workspaceId('22222222-2222-4222-8222-222222222222')
const ARCHITECTURE = collectionId('33333333-3333-4333-8333-333333333333')
const RUNBOOK = documentId('44444444-4444-4444-8444-444444444444')
const CAMPAIGN = documentId('55555555-5555-4555-8555-555555555555')
const NOW = new Date('2026-01-01T00:00:00.000Z')

function hit(id: DocumentId, inWorkspace: WorkspaceId, title: string): SearchServiceHit {
  return {
    documentId: id,
    workspaceId: inWorkspace,
    title,
    snippet: { text: 'a body', ranges: [{ start: 0, end: 1 }] },
    score: 1,
  }
}

function document(
  id: DocumentId,
  inWorkspace: WorkspaceId,
  inCollection: CollectionId | null,
): DocumentRow {
  return {
    id,
    shortId: 'abcdefghjk' as ShortId,
    workspaceId: inWorkspace,
    collectionId: inCollection,
    parentId: null,
    slug: 'a-document',
    path: 'runbooks/a-document.md',
    title: 'A document',
    status: 'published',
    templateId: null,
    templateVersion: null,
    headRevision: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function workspace(id: WorkspaceId, name: string, slug: string): WorkspaceRow {
  return { id, unitId: 'unit', name, slug, createdAt: NOW }
}

function collection(id: CollectionId, inWorkspace: WorkspaceId, name: string): CollectionRow {
  return { id, workspaceId: inWorkspace, name, slug: name.toLowerCase(), createdAt: NOW }
}

function context(overrides: Partial<SearchContext> = {}): SearchContext {
  return {
    documentsById: new Map([
      [RUNBOOK, document(RUNBOOK, ENGINEERING, ARCHITECTURE)],
      [CAMPAIGN, document(CAMPAIGN, MARKETING, null)],
    ]),
    workspacesById: new Map([
      [ENGINEERING, workspace(ENGINEERING, 'Engineering', 'engineering')],
      [MARKETING, workspace(MARKETING, 'Marketing', 'marketing')],
    ]),
    collectionsById: new Map([
      [ARCHITECTURE, collection(ARCHITECTURE, ENGINEERING, 'Architecture')],
    ]),
    ...overrides,
  }
}

const RESULTS: SearchServiceResults = {
  current: [hit(RUNBOOK, ENGINEERING, 'Database failover runbook')],
  elsewhere: [{ workspaceId: MARKETING, hits: [hit(CAMPAIGN, MARKETING, 'Launch campaign')] }],
}

describe('a search response', () => {
  it('carries everything a link and a result row need', () => {
    const response = toSearchResponse('failover', RESULTS, context())

    expect(response.query).toBe('failover')
    expect(response.current).toEqual([
      {
        documentId: RUNBOOK,
        shortId: 'abcdefghjk',
        slug: 'a-document',
        title: 'Database failover runbook',
        path: 'runbooks/a-document.md',
        workspaceId: ENGINEERING,
        breadcrumb: ['Engineering', 'Architecture'],
        snippet: { text: 'a body', ranges: [{ start: 0, end: 1 }] },
        score: 1,
      },
    ])
  })

  it('names the workspace of every other group', () => {
    const response = toSearchResponse('failover', RESULTS, context())
    expect(response.elsewhere).toHaveLength(1)
    expect(response.elsewhere[0]?.workspace).toEqual({
      id: MARKETING,
      slug: 'marketing',
      name: 'Marketing',
    })
  })

  it('leaves the collection out of the breadcrumb of a document that is in none', () => {
    const response = toSearchResponse('failover', RESULTS, context())
    expect(response.elsewhere[0]?.hits[0]?.breadcrumb).toEqual(['Marketing'])
  })

  it('carries the cursor when there is another page', () => {
    expect(toSearchResponse('x', { ...RESULTS, nextCursor: 'more' }, context()).nextCursor).toBe(
      'more',
    )
    expect(toSearchResponse('x', RESULTS, context()).nextCursor).toBeUndefined()
  })

  it('drops a hit whose document has gone since the query', () => {
    const response = toSearchResponse('failover', RESULTS, context({ documentsById: new Map() }))
    expect(response.current).toEqual([])
    expect(response.elsewhere).toEqual([])
  })

  it('drops a group whose workspace it cannot name', () => {
    const response = toSearchResponse(
      'failover',
      RESULTS,
      context({
        workspacesById: new Map([
          [ENGINEERING, workspace(ENGINEERING, 'Engineering', 'engineering')],
        ]),
      }),
    )
    expect(response.current).toHaveLength(1)
    expect(response.elsewhere).toEqual([])
  })
})
