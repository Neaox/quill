import { collectionId, documentId, revisionId, workspaceId } from '@quill/domain'
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
const REVISION = revisionId('a'.repeat(40))

let idCounter = 0
function nextDocumentId(): DocumentId {
  idCounter += 1
  return documentId(`44444444-4444-4444-8444-${idCounter.toString(16).padStart(12, '0')}`)
}

function aDocument(overrides: Partial<IndexableDocument> = {}): IndexableDocument {
  return {
    version: 3,
    documentId: nextDocumentId(),
    revision: REVISION,
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
    contributors: [],
    properties: {},
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

  it('ranks a deprecated document below an equally relevant current one, but still returns it', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    const deprecated = aDocument({ lifecycle: 'deprecated' })
    const current = aDocument({ lifecycle: 'verified' })
    await index.index(deprecated)
    await index.index(current)

    const result = await index.search(query(term('started')), noFilter(), DEFAULT_RANKING_PROFILE, {
      limit: 10,
    })
    expect(result.hits.map((hit) => hit.documentId)).toEqual([
      current.documentId,
      deprecated.documentId,
    ])
    expect(result.hits[1]?.score).toBeCloseTo(
      (result.hits[0]?.score ?? 0) * DEFAULT_RANKING_PROFILE.deprecatedPenalty,
    )
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

describe('createInMemorySearchIndex: who has published', () => {
  const ADA = { name: 'Ada Lovelace', email: 'ada@example.com' }
  const SAM = { name: 'Sam Taylor', email: 'sam@example.com' }
  const GRACE = { name: 'Grace Hopper', email: 'grace@example.com' }
  const directory = {
    emailOf: (userKey: string) => (userKey === 'user:ada' ? 'ada@example.com' : undefined),
    teamMembers: (name: string) =>
      name.toLowerCase() === 'platform' ? ['ada@example.com', 'sam@example.com'] : [],
  }

  async function seeded() {
    const index = createInMemorySearchIndex({ now: () => NOW, directory })
    const byAda = aDocument({ title: 'By Ada', contributors: [ADA] })
    const byAdaAndSam = aDocument({ title: 'By both', contributors: [ADA, SAM] })
    const byGrace = aDocument({ title: 'By Grace', contributors: [GRACE] })
    const byNobody = aDocument({ title: 'By nobody' })
    for (const doc of [byAda, byAdaAndSam, byGrace, byNobody]) await index.index(doc)
    return { index, byAda, byAdaAndSam, byGrace, byNobody }
  }

  const titlesFor = async (
    index: Awaited<ReturnType<typeof seeded>>['index'],
    clause: SearchQuery['clauses'][number],
    principalKeys: readonly string[] = [],
  ) =>
    (
      await index.search(
        query(clause),
        { workspaceIds: [WORKSPACE_A], principalKeys },
        DEFAULT_RANKING_PROFILE,
        { limit: 10 },
      )
    ).hits
      .map((hit) => hit.title)
      .toSorted()

  it('finds what somebody has published by a part of their name, whatever its case', async () => {
    const { index } = await seeded()
    expect(await titlesFor(index, filter('by', 'LOVELACE'))).toEqual(['By Ada', 'By both'])
    expect(await titlesFor(index, filter('by', 'sam'))).toEqual(['By both'])
  })

  it('finds what somebody has published by their address, exactly', async () => {
    const { index } = await seeded()
    expect(await titlesFor(index, filter('by', 'Grace@Example.com'))).toEqual(['By Grace'])
    // An address is not a substring search: part of one names nobody.
    expect(await titlesFor(index, filter('by', 'grace@example'))).toEqual([])
  })

  it('reads me as the person asking, by the user the request is made as', async () => {
    const { index } = await seeded()
    expect(await titlesFor(index, filter('by', 'me'), ['user:ada'])).toEqual(['By Ada', 'By both'])
  })

  it('finds nothing for me when nobody is signed in, rather than everything', async () => {
    const { index } = await seeded()
    expect(await titlesFor(index, filter('by', 'me'))).toEqual([])
  })

  it('finds what any member of a team has published', async () => {
    const { index } = await seeded()
    expect(await titlesFor(index, filter('team', 'Platform'))).toEqual(['By Ada', 'By both'])
    expect(await titlesFor(index, filter('team', 'nobody-by-that-name'))).toEqual([])
  })

  it('can leave a person or a team out', async () => {
    const { index } = await seeded()
    expect(await titlesFor(index, filter('by', 'ada', true))).toEqual(['By Grace', 'By nobody'])
    expect(await titlesFor(index, filter('team', 'platform', true))).toEqual([
      'By Grace',
      'By nobody',
    ])
  })

  it('knows nobody by default, so a team names no one without a directory', async () => {
    const bare = createInMemorySearchIndex({ now: () => NOW })
    await bare.index(aDocument({ title: 'By Ada', contributors: [ADA] }))
    expect(await titlesFor(bare, filter('team', 'platform'))).toEqual([])
    expect(await titlesFor(bare, filter('by', 'me'), ['user:ada'])).toEqual([])
    expect(await titlesFor(bare, filter('by', 'ada'))).toEqual(['By Ada'])
  })
})

describe('createInMemorySearchIndex: suggestions', () => {
  const ADA = { name: 'Ada Lovelace', email: 'ada@example.com' }
  const SAM = { name: 'Sam Taylor', email: 'sam@example.com' }
  const GIT_ONLY = { name: 'Gitty Author', email: 'git@example.com' }

  async function seeded(directory?: { hasAccount(email: string): boolean }) {
    const index = createInMemorySearchIndex({
      now: () => NOW,
      ...(directory === undefined
        ? {}
        : { directory: { emailOf: () => undefined, teamMembers: () => [], ...directory } }),
    })
    const open = aDocument({ tags: ['guide', 'Ops'], contributors: [ADA, GIT_ONLY] })
    const secret = aDocument({ tags: ['secret'], contributors: [SAM] })
    const elsewhere = aDocument({ workspaceId: WORKSPACE_B, tags: ['hidden'], contributors: [SAM] })
    for (const doc of [open, secret, elsewhere]) await index.index(doc)
    index.grant(secret.documentId, ['user:someone-else'])
    return index
  }

  const filterFor = { workspaceIds: [WORKSPACE_A], principalKeys: ['user:me'] }

  it('completes tags from the documents the caller may read, and from no others', async () => {
    const index = await seeded()
    expect(await index.suggest({ field: 'tag', prefix: '', limit: 10 }, filterFor)).toEqual([
      'guide',
      'ops',
    ])
    expect(await index.suggest({ field: 'tag', prefix: 'o', limit: 10 }, filterFor)).toEqual([
      'ops',
    ])
  })

  it('offers every node of a tag hierarchy, so a parent can be searched for', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    await index.index(aDocument({ tags: ['Area/Billing'] }))
    expect(await index.suggest({ field: 'tag', prefix: 'are', limit: 10 }, filterFor)).toEqual([
      'area',
      'area/billing',
    ])
  })

  it('completes the names of people who published something the caller may read', async () => {
    const index = await seeded()
    expect(await index.suggest({ field: 'by', prefix: 'a', limit: 10 }, filterFor)).toEqual([
      'Ada Lovelace',
      'Gitty Author',
    ])
    // Sam published only a document this caller is denied, and one in a workspace not searched.
    expect(await index.suggest({ field: 'by', prefix: 'sam', limit: 10 }, filterFor)).toEqual([])
  })

  it('names only accounts when the directory says which addresses are one', async () => {
    const index = await seeded({ hasAccount: (email) => email === ADA.email })
    expect(await index.suggest({ field: 'by', prefix: '', limit: 10 }, filterFor)).toEqual([
      'Ada Lovelace',
    ])
  })

  it('never offers a name that is an address', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    await index.index(
      aDocument({ contributors: [{ name: 'ada@example.com', email: 'ada@example.com' }, SAM] }),
    )
    expect(await index.suggest({ field: 'by', prefix: '', limit: 5 }, filterFor)).toEqual([
      'Sam Taylor',
    ])
  })

  it('respects the limit and the visibility of a document granted to the caller', async () => {
    const index = await seeded()
    const granted = { workspaceIds: [WORKSPACE_A], principalKeys: ['user:someone-else'] }
    expect(await index.suggest({ field: 'tag', prefix: '', limit: 1 }, granted)).toEqual(['guide'])
    expect(await index.suggest({ field: 'by', prefix: 'sam', limit: 5 }, granted)).toEqual([
      'Sam Taylor',
    ])
  })

  it('returns the tags a hit was indexed with', async () => {
    const index = createInMemorySearchIndex({ now: () => NOW })
    await index.index(aDocument({ tags: ['one', 'two'] }))
    const result = await index.search(query(), noFilter(), DEFAULT_RANKING_PROFILE, { limit: 5 })
    expect(result.hits.map((hit) => hit.tags)).toEqual([['one', 'two']])
  })
})

describe('createInMemorySearchIndex: hierarchical tags', () => {
  async function tagged() {
    const index = createInMemorySearchIndex({ now: () => NOW })
    const billing = aDocument({ tags: ['Area/Billing'] })
    const support = aDocument({ tags: ['area/support/escalations'] })
    const flat = aDocument({ tags: ['areas'] })
    for (const doc of [billing, support, flat]) await index.index(doc)
    return { index, billing, support, flat }
  }
  const found = async (index: ReturnType<typeof createInMemorySearchIndex>, text: string) =>
    (
      await index.search(query(filter('tag', text)), noFilter(), DEFAULT_RANKING_PROFILE, {
        limit: 10,
      })
    ).hits.map((hit) => hit.documentId)

  it('finds a parent tag in every document tagged with it or anything below it', async () => {
    const { index, billing, support } = await tagged()
    expect((await found(index, 'AREA')).toSorted()).toEqual(
      [billing.documentId, support.documentId].toSorted(),
    )
  })

  it('finds only the subtree of a child tag, and not a tag that merely starts the same', async () => {
    const { index, billing, support } = await tagged()
    expect(await found(index, 'area/billing')).toEqual([billing.documentId])
    expect(await found(index, 'area/support')).toEqual([support.documentId])
    expect(await found(index, 'are')).toEqual([])
  })

  it('reads the value as a tag is read, and a value that is no tag matches nothing', async () => {
    const { index, billing } = await tagged()
    expect(await found(index, ' area // billing ')).toEqual([billing.documentId])
    expect(await found(index, '/')).toEqual([])
  })
})

describe('createInMemorySearchIndex: properties', () => {
  async function withProperties() {
    const index = createInMemorySearchIndex({ now: () => NOW })
    const high = aDocument({ properties: { severity: ['high'], regions: ['eu', 'us'] } })
    const low = aDocument({ properties: { severity: ['low'] } })
    const bare = aDocument()
    for (const doc of [high, low, bare]) await index.index(doc)
    return { index, high, low, bare }
  }
  const found = async (
    index: ReturnType<typeof createInMemorySearchIndex>,
    clause: SearchQuery['clauses'][number],
  ) =>
    (
      await index.search(query(clause), noFilter(), DEFAULT_RANKING_PROFILE, { limit: 10 })
    ).hits.map((hit) => hit.documentId)

  it('finds the documents whose property holds the value, whatever its case', async () => {
    const { index, high } = await withProperties()
    expect(await found(index, filter('prop', 'Severity=HIGH'))).toEqual([high.documentId])
    expect(await found(index, filter('prop', 'regions=us'))).toEqual([high.documentId])
  })

  it('finds nothing for a value not held, a key not there, or a filter that is not key=value', async () => {
    const { index } = await withProperties()
    for (const value of ['severity=critical', 'owner=high', 'severity', 'severity=', '=high']) {
      expect(await found(index, filter('prop', value))).toEqual([])
    }
  })

  it('does not mistake a name from the object prototype for a property', async () => {
    const { index } = await withProperties()
    expect(await found(index, filter('prop', 'constructor=function'))).toEqual([])
    expect(await found(index, filter('prop', 'toString=x'))).toEqual([])
  })

  it('can leave a property out, which keeps what does not hold it', async () => {
    const { index, low, bare } = await withProperties()
    expect((await found(index, filter('prop', 'severity=high', true))).toSorted()).toEqual(
      [low.documentId, bare.documentId].toSorted(),
    )
  })
})

describe('createInMemorySearchIndex: facets', () => {
  const OTHER_COLLECTION = collectionId('55555555-5555-4555-8555-555555555555')
  const facetOptions = { facets: ['tag', 'status', 'collection'], limit: 8 } as const

  async function seeded() {
    const index = createInMemorySearchIndex({ now: () => NOW })
    const secret = aDocument({ title: 'Billing secret', tags: ['secret'] })
    const docs = [
      aDocument({
        title: 'Billing runbook',
        tags: ['area/billing', 'runbook'],
        status: 'published',
      }),
      aDocument({ title: 'Billing guide', tags: ['area/billing/invoices'], status: 'draft' }),
      aDocument({
        title: 'Support runbook',
        tags: ['area/support', 'runbook'],
        status: 'published',
        collectionId: OTHER_COLLECTION,
      }),
      aDocument({ title: 'Loose page', tags: [], status: 'published', collectionId: null }),
      aDocument({ title: 'Billing elsewhere', workspaceId: WORKSPACE_B, tags: ['hidden'] }),
      secret,
    ]
    for (const doc of docs) await index.index(doc)
    index.grant(secret.documentId, ['user:someone-else'])
    return index
  }
  const forMe = { workspaceIds: [WORKSPACE_A], principalKeys: ['user:me'] }

  it('counts what the query matches, with every ancestor of a hierarchical tag', async () => {
    const index = await seeded()
    expect(await index.facets(query(), forMe, facetOptions)).toEqual({
      tag: [
        { value: 'area', count: 3 },
        { value: 'area/billing', count: 2 },
        { value: 'runbook', count: 2 },
        { value: 'area/billing/invoices', count: 1 },
        { value: 'area/support', count: 1 },
      ],
      status: [
        { value: 'published', count: 3 },
        { value: 'draft', count: 1 },
      ],
      collection: [
        { value: COLLECTION, count: 2 },
        { value: OTHER_COLLECTION, count: 1 },
      ],
    })
  })

  it('counts the documents the whole query matches, filters included', async () => {
    const index = await seeded()
    const counts = await index.facets(
      query(term('billing'), filter('status', 'published')),
      forMe,
      {
        facets: ['tag'],
        limit: 8,
      },
    )
    expect(counts).toEqual({
      tag: [
        { value: 'area', count: 1 },
        { value: 'area/billing', count: 1 },
        { value: 'runbook', count: 1 },
      ],
    })
  })

  it('counts a phrase and an exclusion as a search does', async () => {
    const index = await seeded()
    const counts = await index.facets(
      query(phrase('billing runbook'), term('guide', true)),
      forMe,
      { facets: ['status'], limit: 8 },
    )
    expect(counts).toEqual({ status: [{ value: 'published', count: 1 }] })
  })

  it('counts only what was asked for, and only up to the limit for tags and statuses', async () => {
    const index = await seeded()
    expect(await index.facets(query(), forMe, { facets: [], limit: 8 })).toEqual({})
    const limited = await index.facets(query(), forMe, { facets: ['tag', 'collection'], limit: 1 })
    expect(limited.tag).toEqual([{ value: 'area', count: 3 }])
    // Collections are returned whole: the application merges the ones that share a name.
    expect(limited.collection).toHaveLength(2)
  })

  it('never counts a document the caller may not read', async () => {
    const index = await seeded()
    const granted = { workspaceIds: [WORKSPACE_A], principalKeys: ['user:someone-else'] }
    const asGranted = await index.facets(query(), granted, { facets: ['tag'], limit: 20 })
    expect(asGranted.tag?.map(({ value }) => value)).toContain('secret')
    const asMe = await index.facets(query(), forMe, { facets: ['tag'], limit: 20 })
    expect(asMe.tag?.map(({ value }) => value)).not.toContain('secret')
    expect(asMe.tag?.map(({ value }) => value)).not.toContain('hidden')
  })

  it('has nothing to count for a stranger', async () => {
    const index = await seeded()
    expect(
      await index.facets(query(), { workspaceIds: [], principalKeys: [] }, facetOptions),
    ).toEqual({ tag: [], status: [], collection: [] })
  })
})
