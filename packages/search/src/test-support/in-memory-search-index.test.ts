import { collectionId, documentId, workspaceId } from '@quill/domain'
import type { DocumentId, WorkspaceId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import type { IndexableDocument } from '../document/indexable-document.ts'
import { DEFAULT_RANKING_PROFILE } from '../ranking/ranking-profile.ts'
import { filter, phrase, term, type SearchQuery } from '../query/query.ts'
import { createInMemorySearchIndex } from './in-memory-search-index.ts'

const WORKSPACE_A = workspaceId('11111111-1111-4111-8111-111111111111')
const WORKSPACE_B = workspaceId('22222222-2222-4222-8222-222222222222')
const COLLECTION = collectionId('33333333-3333-4333-8333-333333333333')
const NOW = new Date('2026-01-01T00:00:00.000Z')

let idCounter = 0
function nextDocumentId(): DocumentId {
  idCounter += 1
  return documentId(`44444444-4444-4444-8444-${idCounter.toString(16).padStart(12, '0')}`)
}

function aDocument(overrides: Partial<IndexableDocument> = {}): IndexableDocument {
  return {
    version: 1,
    documentId: nextDocumentId(),
    workspaceId: WORKSPACE_A,
    collectionId: COLLECTION,
    path: 'doc.md',
    title: 'Getting started',
    headings: [{ text: 'Installation steps', depth: 2, weight: 5 }],
    body: 'Follow these steps to install the tool.',
    tags: ['guide'],
    owners: ['jane@example.com'],
    status: 'published',
    updatedAt: NOW,
    ...overrides,
  }
}

function query(...clauses: SearchQuery['clauses']): SearchQuery {
  return { clauses }
}

function noFilter(workspaceIds: readonly WorkspaceId[] = [WORKSPACE_A]) {
  return { workspaceIds, principalKeys: [] }
}

describe('createInMemorySearchIndex', () => {
  it('finds a document indexed with a matching title term', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    const doc = aDocument()
    await index.index(doc)

    const result = await index.search(query(term('started')), noFilter(), DEFAULT_RANKING_PROFILE, {
      limit: 10,
    })
    expect(result.hits.map((hit) => hit.documentId)).toEqual([doc.documentId])
  })

  it('matches a term against heading text, weighted by the heading’s own weight', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    const doc = aDocument({ title: 'Unrelated', body: 'unrelated body' })
    await index.index(doc)

    const result = await index.search(
      query(term('installation')),
      noFilter(),
      DEFAULT_RANKING_PROFILE,
      {
        limit: 10,
      },
    )
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]?.score).toBeGreaterThan(0)
  })

  it('matches a term against the body', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    const doc = aDocument({ title: 'Unrelated', headings: [] })
    await index.index(doc)

    const result = await index.search(query(term('install')), noFilter(), DEFAULT_RANKING_PROFILE, {
      limit: 10,
    })
    expect(result.hits).toHaveLength(1)
  })

  it('excludes a document that does not contain a required positive term', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    await index.index(aDocument())

    const result = await index.search(query(term('absent')), noFilter(), DEFAULT_RANKING_PROFILE, {
      limit: 10,
    })
    expect(result.hits).toEqual([])
  })

  it('excludes a document that contains an excluded (negated) term', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    await index.index(aDocument())

    const result = await index.search(
      query(term('install', true)),
      noFilter(),
      DEFAULT_RANKING_PROFILE,
      {
        limit: 10,
      },
    )
    expect(result.hits).toEqual([])
  })

  it('keeps a document that does not contain an excluded term', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    const doc = aDocument()
    await index.index(doc)

    const result = await index.search(
      query(term('absent', true)),
      noFilter(),
      DEFAULT_RANKING_PROFILE,
      { limit: 10 },
    )
    expect(result.hits.map((hit) => hit.documentId)).toEqual([doc.documentId])
  })

  it('boosts a phrase match by the exact-phrase boost', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    const bodyOnly = aDocument({ title: 'x', headings: [], body: 'install the tool now' })
    await index.index(bodyOnly)

    const termResult = await index.search(
      query(term('install')),
      noFilter(),
      DEFAULT_RANKING_PROFILE,
      {
        limit: 10,
      },
    )
    const phraseResult = await index.search(
      query(phrase('install')),
      noFilter(),
      DEFAULT_RANKING_PROFILE,
      { limit: 10 },
    )
    expect(phraseResult.hits[0]?.score).toBeGreaterThan(termResult.hits[0]?.score ?? 0)
  })

  it('matches every field filter key', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    const doc = aDocument()
    await index.index(doc)

    const cases: SearchQuery['clauses'] = [
      filter('title', 'getting'),
      filter('tag', 'guide'),
      filter('owner', 'jane@example.com'),
      filter('status', 'published'),
      filter('collection', COLLECTION),
      filter('in', 'workspace'),
    ]
    const results = await Promise.all(
      cases.map((clause) =>
        index.search(query(clause), noFilter(), DEFAULT_RANKING_PROFILE, { limit: 10 }),
      ),
    )
    for (const result of results) {
      expect(result.hits.map((hit) => hit.documentId)).toEqual([doc.documentId])
    }
  })

  it('excludes a document that does not satisfy a field filter', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    await index.index(aDocument())

    const result = await index.search(
      query(filter('status', 'archived')),
      noFilter(),
      DEFAULT_RANKING_PROFILE,
      { limit: 10 },
    )
    expect(result.hits).toEqual([])
  })

  it('excludes a document that satisfies a negated field filter', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    await index.index(aDocument())

    const result = await index.search(
      query(filter('status', 'published', true)),
      noFilter(),
      DEFAULT_RANKING_PROFILE,
      { limit: 10 },
    )
    expect(result.hits).toEqual([])
  })

  it('keeps a document that does not satisfy a negated field filter', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    const doc = aDocument()
    await index.index(doc)

    const result = await index.search(
      query(filter('status', 'archived', true)),
      noFilter(),
      DEFAULT_RANKING_PROFILE,
      { limit: 10 },
    )
    expect(result.hits.map((hit) => hit.documentId)).toEqual([doc.documentId])
  })

  it('treats a document with no collection as not matching a collection filter', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    await index.index(aDocument({ collectionId: null }))

    const result = await index.search(
      query(filter('collection', COLLECTION)),
      noFilter(),
      DEFAULT_RANKING_PROFILE,
      { limit: 10 },
    )
    expect(result.hits).toEqual([])
  })

  it('matches a query with only filters, and only field filters, at the baseline score', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    const doc = aDocument()
    await index.index(doc)

    const result = await index.search(
      query(filter('tag', 'guide')),
      noFilter(),
      DEFAULT_RANKING_PROFILE,
      { limit: 10 },
    )
    expect(result.hits[0]?.score).toBe(DEFAULT_RANKING_PROFILE.fieldWeights.body)
  })

  it('matches an empty query at the baseline score', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    const doc = aDocument()
    await index.index(doc)

    const result = await index.search(query(), noFilter(), DEFAULT_RANKING_PROFILE, { limit: 10 })
    expect(result.hits.map((hit) => hit.documentId)).toEqual([doc.documentId])
  })

  it('never returns a term matching the empty string', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    await index.index(aDocument())

    const result = await index.search(query(term('')), noFilter(), DEFAULT_RANKING_PROFILE, {
      limit: 10,
    })
    expect(result.hits).toEqual([])
  })

  it('only returns documents from a workspace in the visibility filter', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    const inScope = aDocument({ workspaceId: WORKSPACE_A })
    const outOfScope = aDocument({ workspaceId: WORKSPACE_B })
    await index.index(inScope)
    await index.index(outOfScope)

    const result = await index.search(
      query(term('started')),
      noFilter([WORKSPACE_A]),
      DEFAULT_RANKING_PROFILE,
      {
        limit: 10,
      },
    )
    expect(result.hits.map((hit) => hit.documentId)).toEqual([inScope.documentId])
  })

  it('leaves an ungranted document visible to any principal once its workspace is in scope', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    const doc = aDocument()
    await index.index(doc)

    const result = await index.search(query(term('started')), noFilter(), DEFAULT_RANKING_PROFILE, {
      limit: 10,
    })
    expect(result.hits.map((hit) => hit.documentId)).toEqual([doc.documentId])
  })

  it('restricts a granted document to the principals it was granted to', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    const doc = aDocument()
    await index.index(doc)
    index.grant(doc.documentId, ['user:allowed'])

    const denied = await index.search(query(term('started')), noFilter(), DEFAULT_RANKING_PROFILE, {
      limit: 10,
    })
    expect(denied.hits).toEqual([])

    const allowed = await index.search(
      query(term('started')),
      { workspaceIds: [WORKSPACE_A], principalKeys: ['user:allowed'] },
      DEFAULT_RANKING_PROFILE,
      { limit: 10 },
    )
    expect(allowed.hits.map((hit) => hit.documentId)).toEqual([doc.documentId])
  })

  it('no longer returns a document after it is removed', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    const doc = aDocument()
    await index.index(doc)
    await index.remove(doc.documentId)

    const result = await index.search(query(term('started')), noFilter(), DEFAULT_RANKING_PROFILE, {
      limit: 10,
    })
    expect(result.hits).toEqual([])
  })

  it('scores a more recently updated document higher via the recency boost', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    const fresh = aDocument({ updatedAt: NOW })
    const stale = aDocument({ updatedAt: new Date(NOW.getTime() - 365 * 24 * 60 * 60 * 1000) })
    await index.index(fresh)
    await index.index(stale)

    const result = await index.search(query(term('started')), noFilter(), DEFAULT_RANKING_PROFILE, {
      limit: 10,
    })
    expect(result.hits.map((hit) => hit.documentId)).toEqual([fresh.documentId, stale.documentId])
  })

  it('boosts a hit in the current workspace over an equally relevant one elsewhere', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    const elsewhere = aDocument({ workspaceId: WORKSPACE_A })
    const current = aDocument({ workspaceId: WORKSPACE_B })
    await index.index(elsewhere)
    await index.index(current)

    const result = await index.search(
      query(term('started')),
      { workspaceIds: [WORKSPACE_A, WORKSPACE_B], principalKeys: [] },
      DEFAULT_RANKING_PROFILE,
      { limit: 10, currentWorkspaceId: WORKSPACE_B },
    )
    expect(result.hits.map((hit) => hit.documentId)).toEqual([
      current.documentId,
      elsewhere.documentId,
    ])
  })

  it('uses a fixed default clock when none is provided, rather than the wall clock', async () => {
    const index = createInMemorySearchIndex()
    const doc = aDocument()
    await index.index(doc)

    const result = await index.search(query(term('started')), noFilter(), DEFAULT_RANKING_PROFILE, {
      limit: 10,
    })
    expect(result.hits.map((hit) => hit.documentId)).toEqual([doc.documentId])
  })

  it('orders hits by score, highest first, and respects the limit', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    const weak = aDocument({ title: 'x', headings: [], body: 'install once' })
    const strong = aDocument({ title: 'install', headings: [], body: 'install install install' })
    await index.index(weak)
    await index.index(strong)

    const result = await index.search(query(term('install')), noFilter(), DEFAULT_RANKING_PROFILE, {
      limit: 1,
    })
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]?.documentId).toBe(strong.documentId)
  })
})
