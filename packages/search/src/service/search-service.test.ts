import { collectionId, documentId, revisionId, workspaceId } from '@quill/domain'
import type { WorkspaceId } from '@quill/domain'
import { describe, expect, it, vi } from 'vitest'

import type { IndexableDocument } from '../document/indexable-document.ts'
import { DEFAULT_RANKING_PROFILE } from '../ranking/ranking-profile.ts'
import { createInMemorySearchIndex } from '../test-support/index.ts'
import { visibilityFilter } from '../visibility/visibility-filter.ts'
import type { SearchHits, SearchIndex } from './search-index.ts'
import { createSearchService } from './search-service.ts'

const WORKSPACE_A = workspaceId('11111111-1111-4111-8111-111111111111')
const WORKSPACE_B = workspaceId('22222222-2222-4222-8222-222222222222')
const DOCUMENT_ID = documentId('33333333-3333-4333-8333-333333333333')
const COLLECTION_ID = collectionId('44444444-4444-4444-8444-444444444444')
const UPDATED_AT = new Date('2026-01-01T00:00:00.000Z')
const REVISION = revisionId('a'.repeat(40))

function aDocument(overrides: Partial<IndexableDocument> = {}): IndexableDocument {
  return {
    version: 1,
    documentId: DOCUMENT_ID,
    revision: REVISION,
    workspaceId: WORKSPACE_A,
    collectionId: COLLECTION_ID,
    path: 'guide.md',
    title: 'Getting started with Quill',
    headings: [],
    body: 'This guide walks through installing the tool from scratch.',
    tags: [],
    owners: [],
    status: 'published',
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

function filterFor(...workspaceIds: readonly WorkspaceId[]) {
  return visibilityFilter(workspaceIds, [])
}

describe('createSearchService', () => {
  it('returns a parse error for an unparseable query, without calling the index', async () => {
    const index = createInMemorySearchIndex({ now: () => UPDATED_AT })
    const service = createSearchService(index)

    const result = await service.search({ queryText: 'title:', filter: filterFor(WORKSPACE_A) })
    expect(result).toEqual({
      ok: false,
      error: { kind: 'empty-filter-value', position: 5, message: expect.any(String) },
    })
  })

  it('finds a match and builds a snippet from the matched term', async () => {
    const index = createInMemorySearchIndex({ now: () => UPDATED_AT })
    await index.index(aDocument())
    const service = createSearchService(index)

    const result = await service.search({ queryText: 'installing', filter: filterFor(WORKSPACE_A) })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.current).toEqual([])
    expect(result.value.elsewhere).toHaveLength(1)
    const hit = result.value.elsewhere[0]?.hits[0]
    expect(hit).toBeDefined()
    if (hit === undefined) return

    expect(hit.documentId).toBe(DOCUMENT_ID)
    expect(hit.snippet.text).toContain('installing')
    const matchStart = hit.snippet.text.indexOf('installing')
    expect(hit.snippet.ranges).toEqual([
      { start: matchStart, end: matchStart + 'installing'.length },
    ])
  })

  it('groups a hit into current when it is in the request’s current workspace', async () => {
    const index = createInMemorySearchIndex({ now: () => UPDATED_AT })
    await index.index(aDocument())
    const service = createSearchService(index)

    const result = await service.search({
      queryText: 'installing',
      filter: filterFor(WORKSPACE_A),
      currentWorkspaceId: WORKSPACE_A,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.current).toHaveLength(1)
    expect(result.value.elsewhere).toEqual([])
  })

  it('never highlights an excluded (negated) or field-filter term in the snippet', async () => {
    const index = createInMemorySearchIndex({ now: () => UPDATED_AT })
    await index.index(aDocument({ tags: ['guide'] }))
    const service = createSearchService(index)

    const result = await service.search({
      queryText: 'installing -missing tag:guide',
      filter: filterFor(WORKSPACE_A),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const hit = result.value.elsewhere[0]?.hits[0]
    expect(hit?.snippet.ranges).toHaveLength(1)
  })

  it('defaults to DEFAULT_RANKING_PROFILE and forwards it, the visibility filter, and the limit to the index', async () => {
    const search = vi
      .fn<SearchIndex['search']>()
      .mockResolvedValue({ hits: [] } satisfies SearchHits)
    const index: SearchIndex = {
      index: vi.fn<SearchIndex['index']>(),
      remove: vi.fn<SearchIndex['remove']>(),
      search,
    }
    const service = createSearchService(index)

    await service.search({ queryText: 'hello', filter: filterFor(WORKSPACE_A) })

    expect(search).toHaveBeenCalledWith(
      { clauses: [{ kind: 'term', value: 'hello', negated: false }] },
      filterFor(WORKSPACE_A),
      DEFAULT_RANKING_PROFILE,
      { limit: 20 },
    )
  })

  it('forwards a custom ranking profile, cursor, and current workspace to the index', async () => {
    const search = vi
      .fn<SearchIndex['search']>()
      .mockResolvedValue({ hits: [] } satisfies SearchHits)
    const index: SearchIndex = {
      index: vi.fn<SearchIndex['index']>(),
      remove: vi.fn<SearchIndex['remove']>(),
      search,
    }
    const profile = { ...DEFAULT_RANKING_PROFILE, exactPhraseBoost: 5 }
    const service = createSearchService(index, profile)

    await service.search({
      queryText: 'hello',
      filter: filterFor(WORKSPACE_A),
      limit: 5,
      cursor: 'page-2',
      currentWorkspaceId: WORKSPACE_B,
    })

    expect(search).toHaveBeenCalledWith(
      { clauses: [{ kind: 'term', value: 'hello', negated: false }] },
      filterFor(WORKSPACE_A),
      profile,
      { limit: 5, cursor: 'page-2', currentWorkspaceId: WORKSPACE_B },
    )
  })

  it('forwards the index’s nextCursor when it provides one', async () => {
    const search = vi.fn<SearchIndex['search']>().mockResolvedValue({
      hits: [],
      nextCursor: 'page-3',
    } satisfies SearchHits)
    const index: SearchIndex = {
      index: vi.fn<SearchIndex['index']>(),
      remove: vi.fn<SearchIndex['remove']>(),
      search,
    }
    const service = createSearchService(index)

    const result = await service.search({ queryText: 'hello', filter: filterFor(WORKSPACE_A) })
    expect(result).toEqual({
      ok: true,
      value: { current: [], elsewhere: [], nextCursor: 'page-3' },
    })
  })

  it('exposes the profile it was created with', () => {
    const index = createInMemorySearchIndex()
    const service = createSearchService(index, DEFAULT_RANKING_PROFILE)
    expect(service.profile).toBe(DEFAULT_RANKING_PROFILE)
  })
})
