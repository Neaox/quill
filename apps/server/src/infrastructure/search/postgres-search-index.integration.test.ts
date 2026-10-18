import { readFileSync } from 'node:fs'

import { createFakeClock, createFakeIdGenerator } from '@quill/application/test-support'
import type { UnitOfWork } from '@quill/application'
import type {
  IndexableDocument,
  SearchIndex,
  SharedVisibility,
  VisibilityFilter,
} from '@quill/application'
import {
  collectionId as toCollectionId,
  documentId as toDocumentId,
  groupId as toGroupId,
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
import {
  DEFAULT_RANKING_PROFILE,
  expandTagPaths,
  parseQuery,
  shareVisibility,
  visibilityFilter,
} from '@quill/search'
import type { SearchQuery } from '@quill/search'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { decodeSearchCursor, encodeSearchCursor } from './cursor.ts'
import { createTestDatabase } from '../db/test-database.ts'
import type { TestDatabase } from '../db/test-database.ts'
import { createUnitOfWork } from '../repositories/unit-of-work.ts'
import { createPostgresSearchIndex, WIDEN_BELOW_HITS } from './postgres-search-index.ts'
import { createVisibleDocumentResolver } from './visible-documents.ts'
import type { VisibleDocumentResolver, VisibleDocumentsBatch } from './visible-documents.ts'

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
const ADA_USER = toUserId('00000000-0000-4000-8000-0000000000b1')
const SAM_USER = toUserId('00000000-0000-4000-8000-0000000000b2')
const GRACE_USER = toUserId('00000000-0000-4000-8000-0000000000b3')

interface Fixture {
  readonly uow: UnitOfWork
  readonly index: SearchIndex
  readonly engineering: WorkspaceId
  readonly marketing: WorkspaceId
  readonly runbooks: CollectionId
  readonly guides: CollectionId
  readonly campaigns: CollectionId
  /** A workspace of its own for tags, properties and facets, so counting in it disturbs nothing else. */
  readonly catalogue: WorkspaceId
  readonly alpha: CollectionId
  readonly beta: CollectionId
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
  readonly properties?: Readonly<Record<string, readonly string[]>>
  /** Who has published a revision: by address, so `team:` can find them. */
  readonly contributors?: readonly { readonly name: string; readonly email: string }[]
  readonly status?: DocumentStatus
  readonly updatedAt?: Date
}

const ADA = { name: 'Ada Lovelace', email: 'ada@example.com' }
const SAM = { name: 'Sam Taylor', email: 'sam@example.com' }
const GRACE = { name: 'Grace Hopper', email: 'grace@example.com' }
/** A batch that covers one workspace, whole, with another batch to come or not. */
const batchOf = (workspace: WorkspaceId, nextFrom: number | null): VisibleDocumentsBatch => ({
  visible: { kind: 'scoped', wholeWorkspaces: [workspace], documentIds: [] },
  workspaceIds: [workspace],
  nextFrom,
})

const GIT_ONLY = { name: 'Gitty Author', email: 'gitty@example.com' }
const MEMBER_PERSON = { name: 'Member', email: 'member@example.com' }

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
    contributors: [ADA, SAM],
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
    contributors: [GRACE, MEMBER_PERSON],
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
    contributors: [SAM],
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
    contributors: [ADA],
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
    contributors: [GIT_ONLY],
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

const CATALOGUE_SECRET = toDocumentId('00000000-0000-4000-8000-0000000002ff')

/**
 * Documents for the hierarchy of tags, the properties and the facets, in a
 * workspace of their own. Two dozen share one word so that a query for it
 * spans several pages, which is what lets a count be checked against the
 * number of hits that paging to the end produces.
 */
const CATALOGUE: readonly SeedDocument[] = [
  {
    id: toDocumentId('00000000-0000-4000-8000-0000000002a1'),
    workspaceId: 'catalogue' as WorkspaceId,
    collectionId: 'alpha' as CollectionId,
    title: 'Invoice retries',
    body: 'How invoices are retried.',
    tags: ['Area/Billing', 'runbook'],
    properties: { severity: ['high'], region: ['eu', 'us'] },
    status: 'published',
  },
  {
    id: toDocumentId('00000000-0000-4000-8000-0000000002a2'),
    workspaceId: 'catalogue' as WorkspaceId,
    collectionId: 'alpha' as CollectionId,
    title: 'Invoice archive',
    body: 'Where old invoices go.',
    tags: ['area/billing/invoices'],
    properties: { severity: ['low'] },
    status: 'draft',
  },
  {
    id: toDocumentId('00000000-0000-4000-8000-0000000002a3'),
    workspaceId: 'catalogue' as WorkspaceId,
    collectionId: 'beta' as CollectionId,
    title: 'Support escalation',
    body: 'Who to call.',
    tags: ['area/support', 'runbook'],
    properties: { severity: ['high'] },
    status: 'published',
  },
  {
    id: toDocumentId('00000000-0000-4000-8000-0000000002a4'),
    workspaceId: 'catalogue' as WorkspaceId,
    collectionId: 'beta' as CollectionId,
    title: 'Untagged page',
    body: 'Nothing to say.',
    status: 'published',
  },
  {
    // The member is denied this document: nothing about it may be counted.
    id: CATALOGUE_SECRET,
    workspaceId: 'catalogue' as WorkspaceId,
    collectionId: 'alpha' as CollectionId,
    title: 'Secret billing audit',
    body: 'Findings.',
    tags: ['area/billing/secret', 'classified'],
    properties: { severity: ['high'] },
    status: 'published',
  },
  ...Array.from({ length: 24 }, (_unused, at): SeedDocument => ({
    id: toDocumentId(`00000000-0000-4000-8000-0000000003${at.toString().padStart(2, '0')}`),
    workspaceId: 'catalogue' as WorkspaceId,
    collectionId: (at % 3 === 0 ? 'beta' : 'alpha') as CollectionId,
    title: `Lantern notes ${at}`,
    body: 'A lantern is lit before the lantern festival begins.',
    tags: at % 2 === 0 ? ['bulk/even', 'bulk/even/deep'] : ['bulk/odd'],
    status: at % 5 === 0 ? 'draft' : 'published',
  })),
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

  for (const [id, name, email] of [
    [ADA_USER, 'Ada Lovelace', 'ada@example.com'],
    [SAM_USER, 'Sam Taylor', 'sam@example.com'],
    [GRACE_USER, 'Grace Hopper', 'grace@example.com'],
  ] as const) {
    await repos.users.create({ id, email, displayName: name, now: NOW })
  }

  const unit = await repos.units.create({
    id: ids.uuid(),
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: NOW,
  })

  // Platform holds Ada and Sam; SRE is nested inside it and holds Grace, so
  // "the Platform team" includes Grace's work too (ADR-012: groups nest).
  const platform = await repos.groups.create({
    id: toGroupId(ids.uuid()),
    unitId: unit.id,
    parentGroupId: null,
    name: 'Platform',
    now: NOW,
  })
  const sre = await repos.groups.create({
    id: toGroupId(ids.uuid()),
    unitId: unit.id,
    parentGroupId: platform.id,
    name: 'SRE',
    now: NOW,
  })
  for (const [group, user] of [
    [platform.id, ADA_USER],
    [platform.id, SAM_USER],
    [sre.id, GRACE_USER],
  ] as const) {
    await repos.groups.addMember({ groupId: group, userId: user, now: NOW })
  }

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

  const catalogue = await repos.workspaces.create({
    id: toWorkspaceId(ids.uuid()),
    unitId: unit.id,
    name: 'Catalogue',
    slug: 'catalogue',
    now: NOW,
  })

  const collectionsByKey = new Map<string, CollectionId>()
  for (const [key, workspace, name, slug] of [
    ['runbooks', engineering.id, 'Runbooks', 'runbooks'],
    ['guides', engineering.id, 'Guides', 'guides'],
    ['campaigns', marketing.id, 'Campaigns', 'campaigns'],
    ['alpha', catalogue.id, 'Alpha', 'alpha'],
    ['beta', catalogue.id, 'Beta', 'beta'],
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
    ['catalogue', catalogue.id as WorkspaceId],
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

  for (const seedDocument of [...SEED, ...CROWD, ...CATALOGUE]) {
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
  await repos.grants.create({
    id: ids.uuid() as GrantId,
    principalKind: 'user',
    principalId: MEMBER,
    scopeKind: 'document',
    scopeId: CATALOGUE_SECRET,
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
    catalogue: catalogue.id as WorkspaceId,
    alpha: required(collectionsByKey.get('alpha')),
    beta: required(collectionsByKey.get('beta')),
  }
}

/** The nth revision id: forty hex digits, which is what one is. */
const revisionNumbered = (n: number) => toRevisionId(n.toString(16).padStart(40, '0'))

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
    version: 3,
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
    contributors: seedDocument.contributors ?? [],
    properties: seedDocument.properties ?? {},
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

  it('ranks a deprecated document below one that matched as well, and still returns it', async () => {
    // The deprecated one has the lower id, so on a tie the order would put it
    // first: only the penalty can put it second.
    const deprecated = toDocumentId('00000000-0000-4000-8000-0000000000e1')
    const current = toDocumentId('00000000-0000-4000-8000-0000000000e2')
    await Promise.all(
      [deprecated, current].map((id) =>
        fixture.uow.repos.documents.create({
          id,
          shortId: id.slice(-10) as ShortId,
          workspaceId: fixture.engineering,
          collectionId: fixture.guides,
          parentId: null,
          slug: `zymurgy-${id.slice(-2)}`,
          path: `guides/${id.slice(-4)}.md`,
          title: 'Zymurgy handbook',
          status: 'published',
          templateId: null,
          templateVersion: null,
          now: NOW,
        }),
      ),
    )
    const twin: SeedDocument = {
      id: deprecated,
      workspaceId: fixture.engineering,
      collectionId: fixture.guides,
      title: 'Zymurgy handbook',
      body: 'How the zymurgy pipeline ferments its batches.',
    }
    await fixture.index.index({
      ...toIndexable(twin, fixture.engineering, fixture.guides),
      lifecycle: 'deprecated',
    })
    await fixture.index.index({
      ...toIndexable({ ...twin, id: current }, fixture.engineering, fixture.guides),
      lifecycle: 'verified',
    })

    const found = await search('zymurgy', asMember(fixture.engineering))
    expect(found.hits.map((hit) => hit.documentId)).toEqual([current, deprecated])
    const [first, second] = found.hits
    expect(second?.score).toBeCloseTo(
      (first?.score ?? 0) * DEFAULT_RANKING_PROFILE.deprecatedPenalty,
    )

    await fixture.index.remove(deprecated)
    await fixture.index.remove(current)
  })

  it('removes an entry, and removing one that is not there is not an error', async () => {
    await fixture.index.remove(CAMPAIGN)
    expect((await search('campaign', asMember(fixture.marketing))).hits).toEqual([])
    await expect(fixture.index.remove(CAMPAIGN)).resolves.toBeUndefined()
  })
})

/**
 * Finding what somebody has published: by a part of their name, by their
 * address, by `me`, and by the team they are in (`by:` and `team:`).
 */
describe('the PostgreSQL search index: people and teams', () => {
  const found = async (text: string, user: UserId = MEMBER) =>
    titles(await search(text, asUser(user, fixture.engineering, fixture.marketing))).toSorted()

  it('finds what somebody has published by a part of their name, whatever its case', async () => {
    expect(await found('by:LOVELACE')).toEqual(['Database failover runbook'])
    expect(await found('database by:lovel')).toEqual(['Database failover runbook'])
  })

  it('finds what somebody has published by their address, exactly', async () => {
    expect(await found('by:Grace@Example.com')).toEqual(['Cache warm-up'])
    // Part of an address is a part of a name's text, not an address.
    expect(await found('by:grace@example')).toEqual([])
  })

  it('reads me as the person asking', async () => {
    expect(await found('by:me', MEMBER)).toEqual(['Cache warm-up'])
    expect(await found('by:me', OUTSIDER)).toEqual([])
  })

  it('finds what any member of a team has published, nested groups included', async () => {
    // "Onboarding guide" is renamed by an earlier test of this file, which
    // shares one fixture, so it is matched by what it still starts with.
    expect(await found('team:platform')).toEqual([
      'Cache warm-up',
      'Database failover runbook',
      expect.stringMatching(/^Onboarding guide/u),
    ])
    expect(await found('team:SRE')).toEqual(['Cache warm-up'])
  })

  it('finds what the members of a unit have published, by its name or its slug', async () => {
    const everyone = [
      'Cache warm-up',
      'Database failover runbook',
      expect.stringMatching(/^Onboarding guide/u),
    ]
    expect(await found('team:acme')).toEqual(everyone)
    expect(await found('team:ACME')).toEqual(everyone)
  })

  it('finds nothing for a team that is not there, rather than everything', async () => {
    expect(await found('team:no-such-team')).toEqual([])
  })

  it('can leave a person or a team out', async () => {
    expect(await found('-by:ada tag:runbook')).toEqual(['Cache warm-up'])
    expect(await found('database tag:runbook -team:platform')).toEqual([])
  })

  it('treats the characters a pattern would act on as plain characters in a name', async () => {
    expect(await found('by:%')).toEqual([])
    expect(await found('by:_')).toEqual([])
    expect(await found('by:ada%')).toEqual([])
  })

  it('never offers a document the person asking is denied, whoever published it', async () => {
    // Ada published the secrets as well; the member may not read them.
    expect(await found('by:ada')).not.toContain('Database failover secrets')
    expect(titles(await search('by:ada', asUser(ADMIN, fixture.engineering)))).toContain(
      'Database failover secrets',
    )
  })

  it('answers by the name last used, and for a document nobody is recorded as publishing', async () => {
    expect(await found('by:hopper')).toEqual(['Cache warm-up'])
    expect(await found('by:zzzz')).toEqual([])
  })

  it('fills a row indexed before this existed from the revisions it came from (migration 0019)', async () => {
    const published = (n: number, name: string, email: string, at: number) =>
      fixture.uow.repos.revisions.append({
        id: `backfill-${n}`,
        documentId: DATABASE_FAILOVER,
        workspaceId: fixture.engineering,
        revision: revisionNumbered(n),
        authorName: name,
        authorEmail: email,
        timestamp: new Date(NOW.getTime() + at),
        summary: `Revision ${n}`,
        changeNote: null,
        now: NOW,
      })
    await published(1, 'Ada', 'Ada@Example.com', 1_000)
    await published(2, 'Ada Lovelace', 'ada@example.com', 3_000)
    await published(3, 'Sam Taylor', 'sam@example.com', 2_000)

    // A row as it was before the columns existed: their defaults.
    await database.pool.query(
      `UPDATE document_search SET contributor_emails = '{}', contributors_text = '', index_version = 1
       WHERE document_id = $1`,
      [DATABASE_FAILOVER],
    )

    // The statement itself, out of the migration file that will run in production.
    const migration = readFileSync(
      new URL('../../../drizzle/0019_people_search.sql', import.meta.url),
      'utf8',
    )
    const backfill = migration
      .split('--> statement-breakpoint')
      .find((statement) => statement.includes('UPDATE "document_search"'))
    if (backfill === undefined) throw new Error('the migration has no backfill')
    await database.pool.query(backfill)

    const { rows } = await database.pool.query(
      `SELECT contributor_emails, contributors_text, index_version FROM document_search WHERE document_id = $1`,
      [DATABASE_FAILOVER],
    )
    expect(rows).toEqual([
      {
        contributor_emails: ['ada@example.com', 'sam@example.com'],
        // The name last used, folded to lower case, a line each, in order of address.
        contributors_text: 'ada lovelace ada@example.com\nsam taylor sam@example.com',
        index_version: 2,
      },
    ])
    expect(await found('by:lovelace')).toEqual(['Database failover runbook'])
  })
})

/**
 * Completing a filter's value: the names of accounts that have published, and
 * the tags in use, from the documents the caller may read and no others.
 */
describe('the PostgreSQL search index: suggestions', () => {
  const suggest = async (
    field: 'by' | 'tag',
    prefix: string,
    filter: VisibilityFilter = asMember(fixture.engineering, fixture.marketing),
    limit = 10,
  ) => fixture.index.suggest({ field, prefix, limit }, filter)

  it('completes tags, prefix matches first and then the rest, alphabetically', async () => {
    // "filler" contains an r but does not start with one, so it comes second.
    expect(await suggest('tag', 'r')).toEqual(['runbook', 'filler'])
    expect(await suggest('tag', 'u')).toEqual(['guide', 'runbook'])
    expect(await suggest('tag', '')).toEqual(['database', 'filler', 'guide', 'note', 'runbook'])
  })

  it('completes the names of accounts that published something the caller may read', async () => {
    expect(await suggest('by', 'a')).toEqual(['Ada Lovelace', 'Grace Hopper', 'Sam Taylor'])
    expect(await suggest('by', 'ADA')).toEqual(['Ada Lovelace'])
  })

  it('never names a Git-synced author without an account, and never an address', async () => {
    const everyone = await suggest('by', '')
    expect(everyone).not.toContain('Gitty Author')
    expect(everyone.some((name) => name.includes('@'))).toBe(false)
    expect(await suggest('by', 'example.com')).toEqual([])
  })

  it('never offers a display name that is an address', async () => {
    await database.pool.query(`UPDATE users SET display_name = 'grace@example.com' WHERE id = $1`, [
      GRACE_USER,
    ])
    try {
      expect(await suggest('by', 'grace')).toEqual([])
      expect(await suggest('by', 'sam')).toEqual(['Sam Taylor'])
    } finally {
      await database.pool.query(`UPDATE users SET display_name = 'Grace Hopper' WHERE id = $1`, [
        GRACE_USER,
      ])
    }
  })

  it('does not offer what only a document the caller is denied carries', async () => {
    // The secret document is the only one tagged "vault" and the only one
    // that Ada published alone with this tag; the member may not read it.
    await database.pool.query(
      `UPDATE document_search SET tags = array_append(tags, 'vault'), tag_paths = array_append(tag_paths, 'vault') WHERE document_id = $1`,
      [SECRET],
    )
    expect(await suggest('tag', 'vault')).toEqual([])
    expect(await suggest('tag', 'vault', asUser(ADMIN, fixture.engineering))).toEqual(['vault'])
    await database.pool.query(
      `UPDATE document_search SET tags = array_remove(tags, 'vault'), tag_paths = array_remove(tag_paths, 'vault') WHERE document_id = $1`,
      [SECRET],
    )
  })

  it('offers nothing to a stranger with no grants, nor for workspaces not searched', async () => {
    expect(await suggest('tag', '', asUser(OUTSIDER, fixture.engineering))).toEqual([])
    expect(await suggest('by', '', asUser(OUTSIDER, fixture.engineering))).toEqual([])
    expect(await suggest('tag', '', asMember(fixture.marketing))).toEqual([])
    expect(await suggest('tag', '', asMember())).toEqual([])
  })

  it('treats the characters a pattern would act on as plain characters', async () => {
    expect(await suggest('tag', '%')).toEqual([])
    expect(await suggest('tag', '_')).toEqual([])
    expect(await suggest('by', 'a\\')).toEqual([])
  })

  it('respects the limit', async () => {
    expect(await suggest('tag', '', undefined, 2)).toEqual(['database', 'filler'])
  })

  describe('across batches of workspaces', () => {
    const emptyBatch: VisibleDocumentsBatch = {
      visible: { kind: 'everything' },
      workspaceIds: [],
      nextFrom: null,
    }
    const indexOver = (...batches: readonly VisibleDocumentsBatch[]) => {
      const resolve = vi.fn<VisibleDocumentResolver['resolve']>()
      for (const batch of batches) resolve.mockResolvedValueOnce(batch)
      const batched = createPostgresSearchIndex({
        db: database.db,
        visibility: { resolve },
        clock: createFakeClock(NOW),
      })
      return { batched, resolve }
    }
    const filter = () => asMember(fixture.engineering, fixture.marketing)

    it('goes on to the next batch until the limit is filled', async () => {
      const { batched, resolve } = indexOver(
        batchOf(fixture.marketing, 1),
        batchOf(fixture.engineering, null),
      )
      expect(await batched.suggest({ field: 'tag', prefix: '', limit: 10 }, filter())).toEqual([
        'database',
        'filler',
        'guide',
        'note',
        'runbook',
      ])
      expect(resolve).toHaveBeenCalledTimes(2)
    })

    it('stops as soon as the limit is filled', async () => {
      const { batched, resolve } = indexOver(batchOf(fixture.engineering, 1))
      expect(await batched.suggest({ field: 'tag', prefix: '', limit: 1 }, filter())).toEqual([
        'database',
      ])
      expect(resolve).toHaveBeenCalledTimes(1)
    })

    it('stops when a batch covers no workspace, and prefers the workspace the caller is in', async () => {
      const { batched, resolve } = indexOver(batchOf(fixture.engineering, 1), emptyBatch)
      expect(
        await batched.suggest(
          { field: 'tag', prefix: 'guide', limit: 10, currentWorkspaceId: fixture.engineering },
          filter(),
        ),
      ).toEqual(['guide'])
      expect(resolve).toHaveBeenLastCalledWith(
        expect.objectContaining({ currentWorkspaceId: fixture.engineering, from: 1 }),
      )
    })
  })

  it('gives each hit the tags it was indexed with', async () => {
    const found = await search('tag:guide', asMember(fixture.engineering))
    expect(found.hits.map((hit) => hit.tags)).toEqual([['guide']])
  })
})

/** Every hit a search pages through to the end, however many pages that is. */
async function allHits(text: string, filter: VisibilityFilter) {
  const hits: { readonly documentId: DocumentId; readonly tags: readonly string[] }[] = []
  let cursor: string | undefined
  do {
    const page = await search(text, filter, { limit: 5, cursor })
    hits.push(...page.hits)
    cursor = page.nextCursor
  } while (cursor !== undefined)
  return hits
}

describe('the PostgreSQL search index: hierarchical tags', () => {
  const found = async (text: string, user: UserId = MEMBER) =>
    titles(await search(text, asUser(user, fixture.catalogue))).toSorted()

  it('finds a parent tag in everything tagged with it or anything beneath it', async () => {
    expect(await found('tag:area')).toEqual([
      'Invoice archive',
      'Invoice retries',
      'Support escalation',
    ])
  })

  it('finds only the subtree of a child tag', async () => {
    expect(await found('tag:area/billing')).toEqual(['Invoice archive', 'Invoice retries'])
    expect(await found('tag:area/billing/invoices')).toEqual(['Invoice archive'])
    expect(await found('tag:area/support')).toEqual(['Support escalation'])
  })

  it('reads the value as a tag is read when it is indexed, whatever its case or spacing', async () => {
    expect(await found('tag:AREA/Billing')).toEqual(['Invoice archive', 'Invoice retries'])
    expect(await found('tag:"area / billing"')).toEqual(['Invoice archive', 'Invoice retries'])
    expect(await found('tag://area//billing/')).toEqual(['Invoice archive', 'Invoice retries'])
  })

  it('does not take a tag that merely starts the same for a parent', async () => {
    expect(await found('tag:are')).toEqual([])
    expect(await found('tag:area/bill')).toEqual([])
  })

  it('finds nothing for a value that is no tag, rather than everything', async () => {
    expect(await found('tag:/')).toEqual([])
  })

  it('can leave a subtree out', async () => {
    expect(await found('tag:runbook -tag:area/billing')).toEqual(['Support escalation'])
  })

  it('never finds a tag only a denied document carries, however high up the hierarchy', async () => {
    expect(await found('tag:classified')).toEqual([])
    expect(await found('tag:classified', ADMIN)).toEqual(['Secret billing audit'])
    expect(await found('tag:area/billing/secret')).toEqual([])
  })

  it('keeps the tags as they were written, folded, for display', async () => {
    const child = await search('tag:area/billing/invoices', asMember(fixture.catalogue))
    expect(child.hits.map((hit) => hit.tags)).toEqual([['area/billing/invoices']])
    const parent = await search('title:retries', asMember(fixture.catalogue))
    expect(parent.hits.map((hit) => hit.tags)).toEqual([['area/billing', 'runbook']])
  })

  it('suggests every node of the hierarchy, parent before child', async () => {
    const suggest = (prefix: string, filter = asMember(fixture.catalogue)) =>
      fixture.index.suggest({ field: 'tag', prefix, limit: 10 }, filter)
    expect(await suggest('area')).toEqual([
      'area',
      'area/billing',
      'area/billing/invoices',
      'area/support',
    ])
    expect(await suggest('billing')).toEqual(['area/billing', 'area/billing/invoices'])
    // The denied document's own branch is not offered to the member.
    expect(await suggest('secret')).toEqual([])
    expect(await suggest('secret', asUser(ADMIN, fixture.catalogue))).toEqual([
      'area/billing/secret',
    ])
  })

  it('backfills tag paths for existing rows exactly as the one function reads a tag (migration 0020)', async () => {
    const original = await database.pool.query<{
      document_id: string
      tags: string[]
      tag_paths: string[]
    }>(`SELECT document_id, tags, tag_paths FROM document_search`)
    const hostile = ['Weird / Tag ', '//', '', 'solo', 'Area/ Billing//Deep/', ' / ']
    await database.pool.query(
      `UPDATE document_search SET tags = $2::text[] WHERE document_id = $1`,
      [DATABASE_FAILOVER, hostile],
    )
    await database.pool.query(`UPDATE document_search SET tag_paths = '{}'`)

    try {
      const migration = readFileSync(
        new URL('../../../drizzle/0020_tags_properties.sql', import.meta.url),
        'utf8',
      )
      const backfill = migration
        .split('--> statement-breakpoint')
        .find((statement) => statement.includes('UPDATE "document_search"'))
      if (backfill === undefined) throw new Error('the migration has no backfill')
      await database.pool.query(backfill)

      const { rows } = await database.pool.query<{
        document_id: string
        tags: string[]
        tag_paths: string[]
      }>(`SELECT document_id, tags, tag_paths FROM document_search`)
      expect(rows.length).toBeGreaterThan(30)
      for (const row of rows) {
        expect({ id: row.document_id, paths: row.tag_paths.toSorted() }).toEqual({
          id: row.document_id,
          paths: [...expandTagPaths(row.tags)].toSorted(),
        })
      }
      const weird = rows.find((row) => row.document_id === DATABASE_FAILOVER)
      expect(weird?.tag_paths.toSorted()).toEqual(
        ['area', 'area/billing', 'area/billing/deep', 'solo', 'weird', 'weird/tag'].toSorted(),
      )
    } finally {
      for (const row of original.rows) {
        await database.pool.query(
          `UPDATE document_search SET tags = $2::text[], tag_paths = $3::text[] WHERE document_id = $1`,
          [row.document_id, row.tags, row.tag_paths],
        )
      }
    }
  })
})

describe('the PostgreSQL search index: properties', () => {
  const found = async (text: string, user: UserId = MEMBER) =>
    titles(await search(text, asUser(user, fixture.catalogue))).toSorted()

  it('finds what holds a property, whatever the case of the key or the value', async () => {
    expect(await found('prop:severity=high')).toEqual(['Invoice retries', 'Support escalation'])
    expect(await found('prop:SEVERITY=High')).toEqual(['Invoice retries', 'Support escalation'])
    expect(await found('prop:region=us')).toEqual(['Invoice retries'])
  })

  it('narrows beside other clauses and can be left out', async () => {
    expect(await found('invoice prop:severity=low')).toEqual(['Invoice archive'])
    expect(await found('invoice -prop:severity=low')).toEqual(['Invoice retries'])
  })

  it('splits at the first equals sign and treats the rest as the value', async () => {
    await database.pool.query(
      `UPDATE document_search SET properties = '{"note": ["a=b"]}' WHERE title = 'Untagged page'`,
    )
    try {
      expect(await found('prop:note=a=b')).toEqual(['Untagged page'])
    } finally {
      await database.pool.query(
        `UPDATE document_search SET properties = '{}' WHERE title = 'Untagged page'`,
      )
    }
  })

  it('finds nothing for a key or value not held, or a filter that is not key=value', async () => {
    for (const text of [
      'prop:severity=critical',
      'prop:nothing=high',
      'prop:severity',
      'prop:=high',
    ]) {
      expect({ text, found: await found(text) }).toEqual({ text, found: [] })
    }
  })

  it('treats the value as data, never as part of a statement', async () => {
    expect(await found(`prop:severity=high'--`)).toEqual([])
    expect(await found(`prop:"severity';DROP TABLE document_search;--=x"`)).toEqual([])
    expect(await found('prop:severity=high')).toEqual(['Invoice retries', 'Support escalation'])
  })

  it('never finds a document the person asking is denied', async () => {
    // Three documents hold severity=high; the member may read two of them.
    expect(await found('prop:severity=high', ADMIN)).toEqual([
      'Invoice retries',
      'Secret billing audit',
      'Support escalation',
    ])
  })

  it('finds nothing in a row that has no properties', async () => {
    expect(await found('untagged prop:severity=high')).toEqual([])
  })
})

const tagValues = (counts: { readonly tag?: readonly { readonly value: string }[] }) =>
  (counts.tag ?? []).map(({ value }) => value)

describe('the PostgreSQL search index: facets', () => {
  const facets = (
    text: string,
    filter: VisibilityFilter = asMember(fixture.catalogue),
    options: { readonly names?: readonly ('tag' | 'status' | 'collection')[]; limit?: number } = {},
  ) =>
    fixture.index.facets(query(text), filter, {
      facets: options.names ?? ['tag', 'status', 'collection'],
      limit: options.limit ?? 8,
    })

  it('counts tags with every ancestor, statuses and collections over the whole matching set', async () => {
    const counts = await facets('invoice')
    expect(counts.tag).toEqual([
      { value: 'area', count: 2 },
      { value: 'area/billing', count: 2 },
      { value: 'area/billing/invoices', count: 1 },
      { value: 'runbook', count: 1 },
    ])
    expect(counts.status).toEqual([
      { value: 'draft', count: 1 },
      { value: 'published', count: 1 },
    ])
    expect(counts.collection).toEqual([{ value: fixture.alpha, count: 2 }])
  })

  it('includes the query’s own filters, so the web can hide what is already chosen', async () => {
    const counts = await facets('tag:area/billing')
    expect(counts.tag).toContainEqual({ value: 'area/billing', count: 2 })
  })

  it('counts a query that names only filters', async () => {
    const counts = await facets('status:draft collection:alpha', undefined, { names: ['status'] })
    expect(counts).toEqual({ status: [{ value: 'draft', count: 4 }] })
  })

  it('orders by count, then by value in code-point order, and keeps the limit', async () => {
    const counts = await facets('lantern', undefined, { names: ['tag'], limit: 3 })
    expect(counts.tag).toEqual([
      { value: 'bulk', count: 24 },
      { value: 'bulk/even', count: 12 },
      { value: 'bulk/even/deep', count: 12 },
    ])
  })

  it('counts only what was asked for', async () => {
    expect(await facets('lantern', undefined, { names: [] })).toEqual({})
    expect(Object.keys(await facets('lantern', undefined, { names: ['status'] }))).toEqual([
      'status',
    ])
  })

  it('counts each facet once however often it is named', async () => {
    const counts = await facets('lantern', undefined, { names: ['status', 'status'] })
    expect(counts.status).toEqual([
      { value: 'published', count: 19 },
      { value: 'draft', count: 5 },
    ])
  })

  it('equals the number of hits that paging to the end finds', async () => {
    const filter = asMember(fixture.catalogue)
    const hits = await allHits('lantern', filter)
    expect(hits).toHaveLength(24)

    const counts = await facets('lantern', filter, { limit: 50 })
    const tagged = (path: string) =>
      hits.filter((hit) => hit.tags.some((tag) => tag === path || tag.startsWith(`${path}/`)))
    for (const { value, count } of counts.tag ?? []) {
      expect({ value, count }).toEqual({ value, count: tagged(value).length })
      // And a refinement by that value is exactly that many results.
      expect(await allHits(`lantern tag:${value}`, filter)).toHaveLength(count)
    }
    for (const status of counts.status ?? []) {
      expect(await allHits(`lantern status:${status.value}`, filter)).toHaveLength(status.count)
    }
    for (const collection of counts.collection ?? []) {
      expect(await allHits(`lantern collection:${collection.value}`, filter)).toHaveLength(
        collection.count,
      )
    }
  })

  it('equals the paged results for words that are ANDed beside an exclusion', async () => {
    const filter = asMember(fixture.catalogue)
    const text = 'lantern festival -"notes 3"'
    const hits = await allHits(text, filter)
    const counts = await facets(text, filter, { names: ['status'] })
    const total = (counts.status ?? []).reduce((sum, { count }) => sum + count, 0)
    expect(total).toBe(hits.length)
  })

  it('never counts a document the person asking is denied', async () => {
    const asMemberCounts = await facets('tag:area')
    const asAdminCounts = await facets('tag:area', asUser(ADMIN, fixture.catalogue))
    expect(tagValues(asMemberCounts)).not.toContain('classified')
    expect(tagValues(asMemberCounts)).not.toContain('area/billing/secret')
    expect(tagValues(asAdminCounts)).toContain('classified')
    expect(asAdminCounts.collection).toEqual([
      { value: fixture.alpha, count: 3 },
      { value: fixture.beta, count: 1 },
    ])
    expect(asMemberCounts.collection).toEqual([
      { value: fixture.alpha, count: 2 },
      { value: fixture.beta, count: 1 },
    ])
  })

  it('counts a tag with its descendants, and the denied document only for those who may read it', async () => {
    const asMemberCounts = await facets('tag:area/billing', undefined, { names: ['tag'] })
    const asAdminCounts = await facets('tag:area/billing', asUser(ADMIN, fixture.catalogue), {
      names: ['tag'],
    })
    expect(asMemberCounts.tag).toContainEqual({ value: 'area/billing', count: 2 })
    expect(asAdminCounts.tag).toContainEqual({ value: 'area/billing', count: 3 })
  })

  it('gives a stranger empty facets, and counts nothing outside the workspaces searched', async () => {
    const empty = { tag: [], status: [], collection: [] }
    expect(await facets('invoice', asUser(OUTSIDER, fixture.catalogue))).toEqual(empty)
    expect(await facets('invoice', asMember())).toEqual(empty)
    expect(await facets('invoice', asMember(fixture.marketing))).toEqual(empty)
  })

  it('counts a query that matches nothing as nothing', async () => {
    expect(await facets('zzzzzzzz')).toEqual({ tag: [], status: [], collection: [] })
  })

  it('counts a quoted phrase exactly, with no typo arm beside it', async () => {
    const counts = await facets('"lantern festival"', undefined, { names: ['status'] })
    expect((counts.status ?? []).reduce((sum, { count }) => sum + count, 0)).toBe(24)
    expect(await facets('"lantern fest"', undefined, { names: ['status'] })).toEqual({
      status: [],
    })
  })

  describe('across batches of workspaces', () => {
    const indexOver = (...batches: readonly VisibleDocumentsBatch[]) => {
      const resolve = vi.fn<VisibleDocumentResolver['resolve']>()
      for (const batch of batches) resolve.mockResolvedValueOnce(batch)
      const batched = createPostgresSearchIndex({
        db: database.db,
        visibility: { resolve },
        clock: createFakeClock(NOW),
      })
      return { batched, resolve }
    }
    const everywhere = () => asMember(fixture.catalogue, fixture.engineering, fixture.marketing)

    it('adds the counts of every batch, not only the first', async () => {
      const runbooks = async (...batches: readonly VisibleDocumentsBatch[]) => {
        const { batched, resolve } = indexOver(...batches)
        const counts = await batched.facets(query('tag:runbook'), everywhere(), {
          facets: ['tag'],
          limit: 8,
        })
        return { resolve, count: counts.tag?.find(({ value }) => value === 'runbook')?.count ?? 0 }
      }
      const catalogue = await runbooks(batchOf(fixture.catalogue, null))
      const engineering = await runbooks(batchOf(fixture.engineering, null))
      expect(catalogue.count).toBe(2)
      expect(engineering.count).toBeGreaterThan(0)

      const { count, resolve } = await runbooks(
        batchOf(fixture.catalogue, 1),
        batchOf(fixture.engineering, null),
      )
      expect(count).toBe(catalogue.count + engineering.count)
      expect(resolve).toHaveBeenCalledTimes(2)
      expect(resolve).toHaveBeenLastCalledWith(expect.objectContaining({ from: 1 }))
    })

    it('stops when a batch covers no workspace', async () => {
      const empty: VisibleDocumentsBatch = {
        visible: { kind: 'everything' },
        workspaceIds: [],
        nextFrom: null,
      }
      const { batched, resolve } = indexOver(batchOf(fixture.catalogue, 1), empty)
      const counts = await batched.facets(query('lantern'), everywhere(), {
        facets: ['status'],
        limit: 8,
      })
      expect(counts.status).toEqual([
        { value: 'published', count: 19 },
        { value: 'draft', count: 5 },
      ])
      expect(resolve).toHaveBeenCalledTimes(2)
    })
  })
})

describe('the PostgreSQL search index: one visibility resolution per request', () => {
  /** The real resolver, counted, so what is shared is the real walk and not a stand-in. */
  const countedIndex = () => {
    const real = createVisibleDocumentResolver({ uow: fixture.uow })
    const resolve = vi.fn<VisibleDocumentResolver['resolve']>((request) => real.resolve(request))
    const counted = createPostgresSearchIndex({
      db: database.db,
      visibility: { resolve },
      clock: createFakeClock(NOW),
    })
    return { counted, resolve }
  }
  const page = (counted: SearchIndex, filter: VisibilityFilter, visibility?: SharedVisibility) =>
    counted.search(query('tag:area'), filter, DEFAULT_RANKING_PROFILE, {
      limit: 10,
      currentWorkspaceId: fixture.catalogue,
      ...(visibility === undefined ? {} : { visibility }),
    })
  const counts = (counted: SearchIndex, filter: VisibilityFilter, visibility?: SharedVisibility) =>
    counted.facets(query('tag:area'), filter, {
      facets: ['tag', 'status', 'collection'],
      limit: 8,
      currentWorkspaceId: fixture.catalogue,
      ...(visibility === undefined ? {} : { visibility }),
    })

  it('walks permissions once for a page and its facets asked for together', async () => {
    const { counted, resolve } = countedIndex()
    const filter = asMember(fixture.catalogue)
    const visibility = shareVisibility(filter)

    const [hits, facets] = await Promise.all([
      page(counted, filter, visibility),
      counts(counted, filter, visibility),
    ])

    expect(resolve).toHaveBeenCalledTimes(1)
    expect(hits.hits.length).toBeGreaterThan(0)
    expect(facets.status?.length).toBeGreaterThan(0)
  })

  it('walks permissions once when the facets follow the page, too', async () => {
    const { counted, resolve } = countedIndex()
    const filter = asMember(fixture.catalogue)
    const visibility = shareVisibility(filter)

    await page(counted, filter, visibility)
    await counts(counted, filter, visibility)

    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('still walks once per call when nothing is shared', async () => {
    const { counted, resolve } = countedIndex()
    const filter = asMember(fixture.catalogue)

    await Promise.all([page(counted, filter), counts(counted, filter)])

    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('gives the same hits and counts as resolving separately', async () => {
    const { counted } = countedIndex()
    const filter = asMember(fixture.catalogue)
    const visibility = shareVisibility(filter)

    const [hits, facets] = await Promise.all([
      page(counted, filter, visibility),
      counts(counted, filter, visibility),
    ])

    expect(hits).toEqual(await page(fixture.index, filter))
    expect(facets).toEqual(await counts(fixture.index, filter))
  })

  it('never counts or lists a document the caller is denied, shared or not', async () => {
    const { counted } = countedIndex()
    const filter = asMember(fixture.catalogue)
    const visibility = shareVisibility(filter)

    const [hits, facets] = await Promise.all([
      page(counted, filter, visibility),
      counts(counted, filter, visibility),
    ])

    expect(titles(hits)).not.toContain('Secret billing audit')
    expect(tagValues(facets)).not.toContain('classified')
    expect(tagValues(facets)).not.toContain('area/billing/secret')
  })

  it('does not apply what was resolved for one caller to another', async () => {
    const { counted, resolve } = countedIndex()
    const admin = asUser(ADMIN, fixture.catalogue)
    const member = asMember(fixture.catalogue)
    const adminVisibility = shareVisibility(admin)

    // An administrator resolves, then a handle made for them is offered with a member's filter.
    await counts(counted, admin, adminVisibility)
    const asMemberOnAdminsHandle = await counts(counted, member, adminVisibility)

    expect(resolve).toHaveBeenCalledTimes(2)
    expect(tagValues(asMemberOnAdminsHandle)).not.toContain('classified')
    expect(asMemberOnAdminsHandle).toEqual(await counts(fixture.index, member))
  })

  it('does not carry what was resolved from one request to the next', async () => {
    const { counted, resolve } = countedIndex()
    const filter = asMember(fixture.catalogue)

    await counts(counted, filter, shareVisibility(filter))
    await counts(counted, filter, shareVisibility(filter))

    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('shares each batch it walks, and only those, when workspaces are many', async () => {
    const real = createVisibleDocumentResolver({ uow: fixture.uow })
    const resolve = vi.fn<VisibleDocumentResolver['resolve']>(async (request) =>
      request.from === 0
        ? { ...(await real.resolve(request)), nextFrom: 1 }
        : real.resolve({ ...request, from: 0 }),
    )
    const counted = createPostgresSearchIndex({
      db: database.db,
      visibility: { resolve },
      clock: createFakeClock(NOW),
    })
    const filter = asMember(fixture.catalogue)
    const visibility = shareVisibility(filter)

    // The page needs the first batch; the facets walk it and then the second.
    await Promise.all([page(counted, filter, visibility), counts(counted, filter, visibility)])

    expect(resolve.mock.calls.map(([request]) => request.from)).toEqual([0, 1])
  })

  it('resolves once and fails for both when the walk fails', async () => {
    const resolve = vi
      .fn<VisibleDocumentResolver['resolve']>()
      .mockRejectedValue(new Error('the permission walk failed'))
    const counted = createPostgresSearchIndex({
      db: database.db,
      visibility: { resolve },
      clock: createFakeClock(NOW),
    })
    const filter = asMember(fixture.catalogue)
    const visibility = shareVisibility(filter)

    const outcomes = await Promise.allSettled([
      page(counted, filter, visibility),
      counts(counted, filter, visibility),
    ])

    expect(outcomes.map(({ status }) => status)).toEqual(['rejected', 'rejected'])
    expect(resolve).toHaveBeenCalledTimes(1)
  })
})
