import { collectionId, documentId, revisionId, workspaceId } from '@quill/domain'
import type { WorkspaceId } from '@quill/domain'
import { describe, expect, it, vi } from 'vitest'

import type { IndexableDocument } from '../document/indexable-document.ts'
import { DEFAULT_RANKING_PROFILE } from '../ranking/ranking-profile.ts'
import { createInMemorySearchIndex } from '../test-support/index.ts'
import { shareVisibility, visibilityFilter } from '../visibility/visibility-filter.ts'
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
    version: 3,
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
    contributors: [],
    properties: {},
    ...overrides,
  }
}

const numbered = (n: number) => documentId(`66666666-6666-4666-8666-${String(n).padStart(12, '0')}`)

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
    await index.index(aDocument({ tags: ['guide', 'ops'] }))
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
    expect(hit.tags).toEqual(['guide', 'ops'])
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
      suggest: vi.fn<SearchIndex['suggest']>(),
      facets: vi.fn<SearchIndex['facets']>(),
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
      suggest: vi.fn<SearchIndex['suggest']>(),
      facets: vi.fn<SearchIndex['facets']>(),
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
      suggest: vi.fn<SearchIndex['suggest']>(),
      facets: vi.fn<SearchIndex['facets']>(),
    }
    const service = createSearchService(index)

    const result = await service.search({ queryText: 'hello', filter: filterFor(WORKSPACE_A) })
    expect(result).toEqual({
      ok: true,
      value: { current: [], elsewhere: [], nextCursor: 'page-3' },
    })
  })

  describe('a request scoped to one collection', () => {
    const OTHER_COLLECTION = collectionId('55555555-5555-4555-8555-555555555555')

    it('finds only documents in that collection', async () => {
      const index = createInMemorySearchIndex({ now: () => UPDATED_AT })
      await index.index(aDocument({ documentId: numbered(1), title: 'Failover here' }))
      await index.index(
        aDocument({
          documentId: numbered(2),
          title: 'Failover there',
          collectionId: OTHER_COLLECTION,
        }),
      )
      const service = createSearchService(index)

      const result = await service.search({
        queryText: 'failover',
        filter: filterFor(WORKSPACE_A),
        currentWorkspaceId: WORKSPACE_A,
        scope: { collectionId: COLLECTION_ID },
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.current.map((hit) => hit.documentId)).toEqual([numbered(1)])
    })

    it('spends the limit inside the collection, not on the rest of the workspace', async () => {
      const index = createInMemorySearchIndex({ now: () => UPDATED_AT })
      // Ten stronger matches outside the collection would fill a limit of
      // three if the scope were applied after the engine had cut its page.
      for (let n = 1; n <= 10; n += 1) {
        await index.index(
          aDocument({
            documentId: numbered(n),
            title: 'Failover failover failover',
            collectionId: OTHER_COLLECTION,
          }),
        )
      }
      await index.index(
        aDocument({ documentId: numbered(99), title: 'Failover', body: 'Failover plan.' }),
      )
      const service = createSearchService(index)

      const result = await service.search({
        queryText: 'failover',
        filter: filterFor(WORKSPACE_A),
        currentWorkspaceId: WORKSPACE_A,
        limit: 3,
        scope: { collectionId: COLLECTION_ID },
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.current.map((hit) => hit.documentId)).toEqual([numbered(99)])
    })

    it('cannot be widened by the query: a filter naming another collection finds nothing', async () => {
      const index = createInMemorySearchIndex({ now: () => UPDATED_AT })
      await index.index(
        aDocument({ documentId: numbered(2), title: 'Failover', collectionId: OTHER_COLLECTION }),
      )
      const service = createSearchService(index)

      const result = await service.search({
        queryText: `failover collection:${OTHER_COLLECTION}`,
        filter: filterFor(WORKSPACE_A),
        currentWorkspaceId: WORKSPACE_A,
        scope: { collectionId: COLLECTION_ID },
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.current).toEqual([])
    })
  })

  describe('sharing visibility between a page and its facets', () => {
    const visibility = shareVisibility(filterFor(WORKSPACE_A))
    it('hands the shared visibility to the index with the page', async () => {
      const search = vi.fn<SearchIndex['search']>().mockResolvedValue({ hits: [] })
      const service = createSearchService({
        ...createInMemorySearchIndex(),
        search,
      })
      await service.search({
        queryText: 'hello',
        filter: visibility.filter,
        visibility,
        currentWorkspaceId: WORKSPACE_A,
      })
      expect(search).toHaveBeenCalledWith(
        expect.anything(),
        visibility.filter,
        DEFAULT_RANKING_PROFILE,
        { limit: 20, currentWorkspaceId: WORKSPACE_A, visibility },
      )
    })

    it('hands it to the index with the counts, and the workspace the caller is in', async () => {
      const facets = vi.fn<SearchIndex['facets']>().mockResolvedValue({})
      const service = createSearchService({
        ...createInMemorySearchIndex(),
        facets,
      })
      await service.facets({
        queryText: 'hello',
        filter: visibility.filter,
        visibility,
        currentWorkspaceId: WORKSPACE_A,
        facets: ['tag'],
        limit: 8,
      })
      expect(facets).toHaveBeenCalledWith(expect.anything(), visibility.filter, {
        facets: ['tag'],
        limit: 8,
        currentWorkspaceId: WORKSPACE_A,
        visibility,
      })
    })
  })

  describe('facets', () => {
    const OTHER_COLLECTION = collectionId('55555555-5555-4555-8555-555555555555')

    it('refuses a query it cannot read, without calling the index', async () => {
      const facets = vi.fn<SearchIndex['facets']>()
      const service = createSearchService({ ...createInMemorySearchIndex(), facets })
      const result = await service.facets({
        queryText: 'title:',
        filter: filterFor(WORKSPACE_A),
        facets: ['tag'],
        limit: 8,
      })
      expect(result.ok).toBe(false)
      expect(facets).not.toHaveBeenCalled()
    })

    it('hands the parsed query, the visibility filter and the options to the index', async () => {
      const facets = vi.fn<SearchIndex['facets']>().mockResolvedValue({ tag: [] })
      const service = createSearchService({ ...createInMemorySearchIndex(), facets })
      const result = await service.facets({
        queryText: 'hello',
        filter: filterFor(WORKSPACE_A),
        facets: ['tag'],
        limit: 8,
      })
      expect(result).toEqual({ ok: true, value: { tag: [] } })
      expect(facets).toHaveBeenCalledWith(
        { clauses: [{ kind: 'term', value: 'hello', negated: false }] },
        filterFor(WORKSPACE_A),
        { facets: ['tag'], limit: 8 },
      )
    })

    it('counts only inside the scope, as a search does', async () => {
      const index = createInMemorySearchIndex({ now: () => UPDATED_AT })
      await index.index(aDocument({ documentId: numbered(1), title: 'Failover here' }))
      await index.index(
        aDocument({
          documentId: numbered(2),
          title: 'Failover there',
          collectionId: OTHER_COLLECTION,
        }),
      )
      const result = await createSearchService(index).facets({
        queryText: 'failover',
        filter: filterFor(WORKSPACE_A),
        scope: { collectionId: COLLECTION_ID },
        facets: ['collection'],
        limit: 8,
      })
      expect(result).toEqual({
        ok: true,
        value: { collection: [{ value: COLLECTION_ID, count: 1 }] },
      })
    })
  })

  it('exposes the profile it was created with', () => {
    const index = createInMemorySearchIndex()
    const service = createSearchService(index, DEFAULT_RANKING_PROFILE)
    expect(service.profile).toBe(DEFAULT_RANKING_PROFILE)
  })
})
