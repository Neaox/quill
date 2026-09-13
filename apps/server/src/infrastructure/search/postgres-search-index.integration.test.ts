import { createFakeClock, createFakeIdGenerator } from '@quill/application/test-support'
import type { UnitOfWork } from '@quill/application'
import type { IndexableDocument, SearchIndex, VisibilityFilter } from '@quill/application'
import {
  collectionId as toCollectionId,
  documentId as toDocumentId,
  revisionId as toRevisionId,
  userId as toUserId,
  workspaceId as toWorkspaceId,
} from '@quill/domain'
import type {
  CollectionId,
  DocumentId,
  DocumentStatus,
  ShortId,
  UserId,
  WorkspaceId,
} from '@quill/domain'
import type { GrantId } from '@quill/application'
import { DEFAULT_RANKING_PROFILE, parseQuery, visibilityFilter } from '@quill/search'
import type { SearchQuery } from '@quill/search'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { decodeSearchCursor, encodeSearchCursor } from './cursor.ts'
import { createTestDatabase } from '../db/test-database.ts'
import type { TestDatabase } from '../db/test-database.ts'
import { createUnitOfWork } from '../repositories/unit-of-work.ts'
import { createPostgresSearchIndex, WIDEN_BELOW_HITS } from './postgres-search-index.ts'
import { createVisibleDocumentResolver } from './visible-documents.ts'

/**
 * The PostgreSQL adapter against a real PostgreSQL (ADR-010): ranking order,
 * phrases, exclusions, field filters, workspace affinity, paging, typo
 * tolerance — and the one that matters most, that a document a principal
 * cannot read never appears, however well its title matches.
 */

const NOW = new Date('2026-02-01T00:00:00.000Z')
const REVISION = toRevisionId('a'.repeat(40))

const MEMBER = toUserId('00000000-0000-4000-8000-0000000000a1')
const OUTSIDER = toUserId('00000000-0000-4000-8000-0000000000a2')
const ADMIN = toUserId('00000000-0000-4000-8000-0000000000a3')

interface Fixture {
  readonly uow: UnitOfWork
  readonly index: SearchIndex
  readonly engineering: WorkspaceId
  readonly marketing: WorkspaceId
  readonly runbooks: CollectionId
  readonly guides: CollectionId
  readonly campaigns: CollectionId
}

let database: TestDatabase
let fixture: Fixture

/** A document row plus its index entry, which is what a publish leaves behind. */
interface SeedDocument {
  readonly id: DocumentId
  readonly workspaceId: WorkspaceId
  readonly collectionId: CollectionId
  readonly title: string
  readonly headings?: readonly string[]
  readonly body: string
  readonly tags?: readonly string[]
  readonly owners?: readonly string[]
  readonly status?: DocumentStatus
  readonly updatedAt?: Date
}

const DATABASE_FAILOVER = toDocumentId('00000000-0000-4000-8000-0000000000d1')
const CACHE_FAILOVER = toDocumentId('00000000-0000-4000-8000-0000000000d2')
const ONBOARDING = toDocumentId('00000000-0000-4000-8000-0000000000d3')
const SECRET = toDocumentId('00000000-0000-4000-8000-0000000000d4')
const CAMPAIGN = toDocumentId('00000000-0000-4000-8000-0000000000d5')
const NEAR_MISS = toDocumentId('00000000-0000-4000-8000-0000000000d6')

/**
 * A screenful of documents matching every word of one query, and one matching
 * a single word of it: what the AND-first rule is about, and what proves the
 * widening did not happen when it should not have.
 */
const CROWD: readonly SeedDocument[] = [
  ...Array.from({ length: WIDEN_BELOW_HITS }, (_unused, at): SeedDocument => ({
    id: toDocumentId(`00000000-0000-4000-8000-0000000001${at.toString().padStart(2, '0')}`),
    workspaceId: 'engineering' as WorkspaceId,
    collectionId: 'runbooks' as CollectionId,
    title: `Crowded page filler ${at}`,
    body: 'This document is crowded onto the page with filler, along with many like it.',
    tags: ['filler'],
    status: 'published',
    updatedAt: new Date('2026-01-10T00:00:00.000Z'),
  })),
  {
    id: toDocumentId('00000000-0000-4000-8000-000000000199'),
    workspaceId: 'engineering' as WorkspaceId,
    collectionId: 'runbooks' as CollectionId,
    // The title shares no trigrams with the query either, so the only thing
    // that could bring this document back is the OR widening.
    title: 'Solitary entry',
    body: 'Crowded, and nothing else the other query asks for.',
    tags: ['filler'],
    status: 'published',
    updatedAt: new Date('2026-01-10T00:00:00.000Z'),
  },
]

const SEED: readonly SeedDocument[] = [
  {
    id: DATABASE_FAILOVER,
    workspaceId: 'engineering' as WorkspaceId,
    collectionId: 'runbooks' as CollectionId,
    title: 'Database failover runbook',
    headings: ['Detect the outage', 'Promote the replica'],
    body: 'When the primary database stops answering, promote the standby replica. The failover takes about four minutes and the cache is rebuilt afterwards.',
    tags: ['Runbook', 'database'],
    owners: ['Ada Lovelace'],
    status: 'published',
    updatedAt: new Date('2026-01-30T00:00:00.000Z'),
  },
  {
    id: CACHE_FAILOVER,
    workspaceId: 'engineering' as WorkspaceId,
    collectionId: 'runbooks' as CollectionId,
    title: 'Cache warm-up',
    headings: ['Rebuild the cache'],
    body: 'The cache is rebuilt from the database after every failover. Warming it takes ten minutes.',
    tags: ['runbook'],
    owners: ['grace hopper'],
    status: 'published',
    updatedAt: new Date('2025-06-01T00:00:00.000Z'),
  },
  {
    id: ONBOARDING,
    workspaceId: 'engineering' as WorkspaceId,
    collectionId: 'guides' as CollectionId,
    title: 'Onboarding guide',
    body: 'Welcome to the team. Read the database runbook on your first day.',
    tags: ['guide'],
    status: 'draft',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
  {
    id: SECRET,
    workspaceId: 'engineering' as WorkspaceId,
    collectionId: 'guides' as CollectionId,
    title: 'Database failover secrets',
    body: 'The failover credentials for the primary database live in the vault.',
    tags: ['runbook'],
    status: 'published',
    updatedAt: new Date('2026-01-31T00:00:00.000Z'),
  },
  {
    id: NEAR_MISS,
    workspaceId: 'engineering' as WorkspaceId,
    collectionId: 'runbooks' as CollectionId,
    // A title a trigram arm finds from "database failover" and a body that
    // does not contain that phrase anywhere.
    title: 'Databse failovr notes',
    body: 'Notes taken during the incident. Nothing here repeats the phrase.',
    tags: ['note'],
    status: 'published',
    updatedAt: new Date('2026-01-25T00:00:00.000Z'),
  },
  {
    id: CAMPAIGN,
    workspaceId: 'marketing' as WorkspaceId,
    collectionId: 'campaigns' as CollectionId,
    title: 'Launch campaign database',
    body: 'The campaign database holds every prospect we have spoken to.',
    tags: ['campaign'],
    status: 'published',
    updatedAt: new Date('2026-01-20T00:00:00.000Z'),
  },
]

beforeAll(async () => {
  database = await createTestDatabase()
  fixture = await seed()
}, 60_000)

afterAll(async () => {
  await database.drop()
})

async function seed(): Promise<Fixture> {
  const ids = createFakeIdGenerator()
  const uow = createUnitOfWork(database.db, database.pool, ids)
  const { repos } = uow

  for (const [id, name, admin] of [
    [MEMBER, 'Member', false],
    [OUTSIDER, 'Outsider', false],
    [ADMIN, 'Admin', true],
  ] as const) {
    await repos.users.create({ id, email: `${name}@example.com`, displayName: name, now: NOW })
    if (admin) await repos.users.setInstanceAdmin(id, true)
  }

  const unit = await repos.units.create({
    id: ids.uuid(),
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: NOW,
  })

  const engineering = await repos.workspaces.create({
    id: toWorkspaceId(ids.uuid()),
    unitId: unit.id,
    name: 'Engineering',
    slug: 'engineering',
    now: NOW,
  })
  const marketing = await repos.workspaces.create({
    id: toWorkspaceId(ids.uuid()),
    unitId: unit.id,
    name: 'Marketing',
    slug: 'marketing',
    now: NOW,
  })

  const collectionsByKey = new Map<string, CollectionId>()
  for (const [key, workspace, name, slug] of [
    ['runbooks', engineering.id, 'Runbooks', 'runbooks'],
    ['guides', engineering.id, 'Guides', 'guides'],
    ['campaigns', marketing.id, 'Campaigns', 'campaigns'],
  ] as const) {
    const created = await repos.collections.create({
      id: toCollectionId(ids.uuid()),
      workspaceId: workspace,
      name,
      slug,
      now: NOW,
    })
    collectionsByKey.set(key, created.id as CollectionId)
  }

  const workspaceByKey = new Map<string, WorkspaceId>([
    ['engineering', engineering.id as WorkspaceId],
    ['marketing', marketing.id as WorkspaceId],
  ])

  // Both workspaces are readable; one document inside Engineering is denied to
  // the member, which is the leak test below.
  for (const workspace of workspaceByKey.values()) {
    await repos.grants.create({
      id: ids.uuid() as GrantId,
      principalKind: 'user',
      principalId: MEMBER,
      scopeKind: 'workspace',
      scopeId: workspace,
      role: 'viewer',
      effect: 'allow',
      createdBy: null,
      now: NOW,
    })
  }

  const index = createPostgresSearchIndex({
    db: database.db,
    visibility: createVisibleDocumentResolver({ uow }),
    clock: createFakeClock(NOW),
  })

  for (const seedDocument of [...SEED, ...CROWD]) {
    const workspaceId = required(workspaceByKey.get(seedDocument.workspaceId))
    const collectionId = required(collectionsByKey.get(seedDocument.collectionId))
    await repos.documents.create({
      id: seedDocument.id,
      shortId: seedDocument.id.slice(-10) as ShortId,
      workspaceId,
      collectionId,
      parentId: null,
      slug: seedDocument.title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-'),
      path: `${seedDocument.collectionId}/${seedDocument.id.slice(-4)}.md`,
      title: seedDocument.title,
      status: 'published',
      templateId: null,
      templateVersion: null,
      now: NOW,
    })
    await index.index(toIndexable(seedDocument, workspaceId, collectionId))
  }

  await repos.grants.create({
    id: ids.uuid() as GrantId,
    principalKind: 'user',
    principalId: MEMBER,
    scopeKind: 'document',
    scopeId: SECRET,
    role: 'viewer',
    effect: 'deny',
    createdBy: null,
    now: NOW,
  })

  return {
    uow,
    index,
    engineering: engineering.id as WorkspaceId,
    marketing: marketing.id as WorkspaceId,
    runbooks: required(collectionsByKey.get('runbooks')),
    guides: required(collectionsByKey.get('guides')),
    campaigns: required(collectionsByKey.get('campaigns')),
  }
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('fixture is incomplete')
  return value
}

function toIndexable(
  seedDocument: SeedDocument,
  workspaceId: WorkspaceId,
  collectionId: CollectionId,
): IndexableDocument {
  return {
    version: 1,
    documentId: seedDocument.id,
    revision: REVISION,
    workspaceId,
    collectionId,
    path: `${seedDocument.collectionId}/${seedDocument.id.slice(-4)}.md`,
    title: seedDocument.title,
    headings: (seedDocument.headings ?? []).map((text) => ({ text, depth: 2, weight: 5 })),
    body: seedDocument.body,
    tags: [...(seedDocument.tags ?? [])],
    owners: [...(seedDocument.owners ?? [])],
    status: seedDocument.status ?? 'published',
    updatedAt: seedDocument.updatedAt ?? NOW,
  }
}

function query(text: string): SearchQuery {
  const parsed = parseQuery(text)
  if (!parsed.ok) throw new Error(`the test's own query did not parse: ${parsed.error.message}`)
  return parsed.value
}

function asMember(...workspaceIds: readonly WorkspaceId[]): VisibilityFilter {
  return visibilityFilter(workspaceIds, [{ kind: 'user', userId: MEMBER }, { kind: 'public' }])
}

function asUser(user: UserId, ...workspaceIds: readonly WorkspaceId[]): VisibilityFilter {
  return visibilityFilter(workspaceIds, [{ kind: 'user', userId: user }, { kind: 'public' }])
}

async function search(
  text: string,
  filter: VisibilityFilter,
  options: {
    readonly limit?: number | undefined
    readonly cursor?: string | undefined
    readonly currentWorkspaceId?: WorkspaceId | undefined
  } = {},
) {
  return fixture.index.search(query(text), filter, DEFAULT_RANKING_PROFILE, {
    limit: options.limit ?? 10,
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    ...(options.currentWorkspaceId === undefined
      ? {}
      : { currentWorkspaceId: options.currentWorkspaceId }),
  })
}

function titles(hits: { readonly hits: readonly { readonly title: string }[] }): readonly string[] {
  return hits.hits.map((hit) => hit.title)
}

describe('the PostgreSQL search index', () => {
  it('ranks a title match above a body match', async () => {
    const found = await search('failover', asMember(fixture.engineering))
    expect(titles(found)[0]).toBe('Database failover runbook')
    expect(titles(found)).toContain('Cache warm-up')
  })

  it('never returns a document the principal is denied, however well its title matches', async () => {
    const found = await search('database failover secrets', asMember(fixture.engineering))
    expect(titles(found)).not.toContain('Database failover secrets')
    expect(found.hits.some((hit) => hit.documentId === SECRET)).toBe(false)
  })

  it('returns nothing at all to a principal with no grant', async () => {
    const found = await search('failover', asUser(OUTSIDER, fixture.engineering))
    expect(found.hits).toEqual([])
  })

  it('shows an instance admin the document a member is denied', async () => {
    const found = await search('database failover secrets', asUser(ADMIN, fixture.engineering))
    expect(titles(found)).toContain('Database failover secrets')
  })

  it('matches a quoted phrase as a phrase', async () => {
    const found = await search('"campaign database"', asMember(fixture.marketing))
    expect(titles(found)).toEqual(['Launch campaign database'])
  })

  it('excludes what the author excluded', async () => {
    const withCache = await search('database', asMember(fixture.engineering))
    expect(titles(withCache)).toContain('Cache warm-up')
    const withoutCache = await search('database -cache', asMember(fixture.engineering))
    expect(titles(withoutCache)).not.toContain('Cache warm-up')
  })

  it('filters by tag, case-insensitively', async () => {
    const found = await search('database tag:RUNBOOK', asMember(fixture.engineering))
    expect(titles(found)).toContain('Database failover runbook')
    expect(titles(found)).not.toContain('Onboarding guide')
  })

  it('filters by owner, status and collection', async () => {
    expect(
      titles(await search('database owner:"ada lovelace"', asMember(fixture.engineering))),
    ).toEqual(['Database failover runbook'])
    expect(titles(await search('database status:draft', asMember(fixture.engineering)))).toEqual([
      'Onboarding guide',
    ])
    expect(
      titles(await search('database collection:guides', asMember(fixture.engineering))),
    ).toEqual(['Onboarding guide'])
  })

  it('keeps a document with no collection when a collection filter is negated', async () => {
    const found = await search('database -collection:guides', asMember(fixture.engineering))
    expect(titles(found)).toContain('Database failover runbook')
    expect(titles(found)).not.toContain('Onboarding guide')
  })

  it('narrows to one workspace with in:, and never widens past the filter', async () => {
    const inMarketing = await search(
      'database in:marketing',
      asMember(fixture.engineering, fixture.marketing),
    )
    expect(titles(inMarketing)).toEqual(['Launch campaign database'])

    const unreadable = await search('database in:marketing', asMember(fixture.engineering))
    expect(unreadable.hits).toEqual([])
  })

  it('puts the current workspace first through the affinity boost', async () => {
    const both = [fixture.engineering, fixture.marketing] as const
    const fromMarketing = await search('database', asMember(...both), {
      currentWorkspaceId: fixture.marketing,
    })
    expect(titles(fromMarketing)[0]).toBe('Launch campaign database')

    const fromEngineering = await search('database', asMember(...both), {
      currentWorkspaceId: fixture.engineering,
    })
    expect(titles(fromEngineering)[0]).not.toBe('Launch campaign database')
  })

  it('does not let a fuzzy title widen past a quoted phrase', async () => {
    // Unquoted, the near-miss title is exactly what typo tolerance is for.
    const fuzzy = await search('databse failovr', asMember(fixture.engineering))
    expect(titles(fuzzy)).toContain('Databse failovr notes')

    // Quoted, the author is being exact, and a document that does not contain
    // the phrase must not be offered however alike its title looks.
    const exact = await search('"database failover"', asMember(fixture.engineering))
    expect(titles(exact)).not.toContain('Databse failovr notes')
    expect(titles(exact)).toContain('Database failover runbook')
  })

  it('keeps every word a requirement while there is plenty to read, and widens when there is not', async () => {
    // Twenty documents match all three words, which is a screenful, so the
    // document matching only one of them stays out of the answer.
    const plenty = await search('crowded page filler', asMember(fixture.engineering), {
      limit: WIDEN_BELOW_HITS + 5,
    })
    expect(titles(plenty)).not.toContain('Solitary entry')
    expect(plenty.hits.length).toBeGreaterThanOrEqual(WIDEN_BELOW_HITS)

    // Two words with one document between them is not a screenful, so the
    // near misses are offered rather than an almost-empty page.
    const sparse = await search('onboarding replica', asMember(fixture.engineering))
    expect(titles(sparse)).toContain('Onboarding guide')
    expect(titles(sparse)).toContain('Database failover runbook')
  })

  it('records the revision the entry was projected from, not the head at write time', async () => {
    const later = toRevisionId('b'.repeat(40))
    const seeded = SEED.find((entry) => entry.id === ONBOARDING)
    if (seeded === undefined) throw new Error('fixture is incomplete')
    await fixture.index.index({
      ...toIndexable(seeded, fixture.engineering, fixture.guides),
      revision: later,
    })

    const { rows } = await database.pool.query<{ revision: string }>(
      'SELECT revision FROM document_search WHERE document_id = $1',
      [ONBOARDING],
    )
    expect(rows[0]?.revision).toBe(later)
  })

  it('indexes a body too dense for a tsvector by storing as much of it as fits', async () => {
    const seeded = SEED.find((entry) => entry.id === ONBOARDING)
    if (seeded === undefined) throw new Error('fixture is incomplete')
    // Distinct tokens, so nothing is de-duplicated on the way into the vector.
    const dense = Array.from({ length: 200_000 }, (_unused, at) => `t${at}`).join(' ')

    await expect(
      fixture.index.index({
        ...toIndexable(seeded, fixture.engineering, fixture.guides),
        title: 'Enormous document',
        body: dense,
      }),
    ).resolves.toBeUndefined()

    const { rows } = await database.pool.query<{ length: number }>(
      'SELECT octet_length(body) AS length FROM document_search WHERE document_id = $1',
      [ONBOARDING],
    )
    expect(rows[0]?.length).toBeLessThan(Buffer.byteLength(dense, 'utf8'))
    expect(titles(await search('enormous', asMember(fixture.engineering)))).toContain(
      'Enormous document',
    )

    // Put the fixture back for the tests after this one.
    await fixture.index.index(toIndexable(seeded, fixture.engineering, fixture.guides))
  }, 30_000)

  it('still finds the runbook from a misspelled title', async () => {
    const found = await search('databse failover runbok', asMember(fixture.engineering))
    expect(titles(found)).toContain('Database failover runbook')
  })

  it('leaves typo tolerance out when the database has no pg_trgm', async () => {
    const withoutTrigram = createPostgresSearchIndex({
      db: database.db,
      visibility: createVisibleDocumentResolver({ uow: fixture.uow }),
      clock: createFakeClock(NOW),
      trigram: async () => false,
    })
    const found = await withoutTrigram.search(
      // Far enough from any real token that full text cannot reach it: the
      // only thing that could find these documents is trigram similarity.
      query('datbse runbuk'),
      asMember(fixture.engineering),
      DEFAULT_RANKING_PROFILE,
      { limit: 10 },
    )
    expect(found.hits).toEqual([])
  })

  it('reports a refusal that is not about size rather than retrying it', async () => {
    const orphan = SEED.find((entry) => entry.id === ONBOARDING)
    if (orphan === undefined) throw new Error('fixture is incomplete')
    await expect(
      fixture.index.index({
        ...toIndexable(orphan, fixture.engineering, fixture.guides),
        // No such document, so the foreign key refuses the row. Truncating the
        // body would not help, and pretending it did would hide the fault.
        documentId: toDocumentId('00000000-0000-4000-8000-0000000000ff'),
      }),
    ).rejects.toThrow(/Failed query/)
  })

  it('answers nothing once the cursor has run past every workspace it may read', async () => {
    const spent = encodeSearchCursor({
      from: 99,
      arm: 'all',
      at: NOW.toISOString(),
      keyset: null,
    })
    const found = await search('database', asMember(fixture.engineering), { cursor: spent })
    expect(found).toEqual({ hits: [] })
  })

  it('asks again after a probe that failed, rather than writing the database off', async () => {
    let attempts = 0
    const flaky = createPostgresSearchIndex({
      db: database.db,
      visibility: createVisibleDocumentResolver({ uow: fixture.uow }),
      clock: createFakeClock(NOW),
      trigram: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('the database was unreachable')
        return false
      },
    })

    await expect(
      flaky.search(query('failover'), asMember(fixture.engineering), DEFAULT_RANKING_PROFILE, {
        limit: 10,
      }),
    ).rejects.toThrow('the database was unreachable')

    await expect(
      flaky.search(query('failover'), asMember(fixture.engineering), DEFAULT_RANKING_PROFILE, {
        limit: 10,
      }),
    ).resolves.toBeDefined()
    expect(attempts).toBe(2)
  })

  it('hands back a cursor for the next batch of workspaces once this one is spent', async () => {
    const resolver = createVisibleDocumentResolver({ uow: fixture.uow })
    const paged = createPostgresSearchIndex({
      db: database.db,
      // As it would answer for a caller who can read more workspaces than one
      // request resolves permissions for.
      visibility: {
        resolve: async (request) => ({ ...(await resolver.resolve(request)), nextFrom: 1 }),
      },
      clock: createFakeClock(NOW),
    })

    const found = await paged.search(
      query('onboarding'),
      asMember(fixture.engineering),
      DEFAULT_RANKING_PROFILE,
      { limit: 10 },
    )
    expect(found.nextCursor).toBeDefined()
    expect(decodeSearchCursor(String(found.nextCursor))).toMatchObject({ from: 1, keyset: null })
  })

  it('pages with a cursor and stops when there is nothing left', async () => {
    const first = await search('database', asMember(fixture.engineering), { limit: 1 })
    expect(first.hits).toHaveLength(1)
    expect(first.nextCursor).toBeDefined()

    const second = await search('database', asMember(fixture.engineering), {
      limit: 1,
      cursor: first.nextCursor,
    })
    expect(second.hits).toHaveLength(1)
    expect(titles(second)[0]).not.toBe(titles(first)[0])

    const everything = await search('database', asMember(fixture.engineering), { limit: 50 })
    expect(everything.nextCursor).toBeUndefined()
  })

  it('treats a cursor it did not write as no cursor at all', async () => {
    const fresh = await search('database', asMember(fixture.engineering), { limit: 2 })
    const mangled = await search('database', asMember(fixture.engineering), {
      limit: 2,
      cursor: 'not-a-cursor',
    })
    expect(titles(mangled)).toEqual(titles(fresh))
  })

  it('lists by recency when the query names no text', async () => {
    const found = await search('tag:runbook', asMember(fixture.engineering))
    expect(titles(found)).toEqual(['Database failover runbook', 'Cache warm-up'])
    expect(found.hits[0]?.body.length).toBeGreaterThan(0)
  })

  it('answers an empty visible set and an empty workspace set without asking the database', async () => {
    expect(await search('database', visibilityFilter([], []))).toEqual({ hits: [] })
    expect(await search('database', asUser(OUTSIDER, fixture.engineering))).toEqual({ hits: [] })
  })

  it('re-indexing the same document replaces its entry', async () => {
    const replaced = SEED.find((entry) => entry.id === ONBOARDING)
    if (replaced === undefined) throw new Error('fixture is incomplete')
    await fixture.index.index({
      ...toIndexable(replaced, fixture.engineering, fixture.guides),
      title: 'Onboarding guide, revised',
    })
    const found = await search('onboarding', asMember(fixture.engineering))
    expect(titles(found)).toEqual(['Onboarding guide, revised'])
  })

  it('removes an entry, and removing one that is not there is not an error', async () => {
    await fixture.index.remove(CAMPAIGN)
    expect((await search('campaign', asMember(fixture.marketing))).hits).toEqual([])
    await expect(fixture.index.remove(CAMPAIGN)).resolves.toBeUndefined()
  })
})
