import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { documentId, revisionId, userId, workspaceId } from '@quill/domain'
import type { CollectionId, GroupId } from '@quill/domain'

import { createUuidGenerator } from '../uuid-generator.ts'
import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createCollectionRepository } from './collection-repository.ts'
import { createDocumentLinksRepository } from './document-links-repository.ts'
import { createDocumentRepository } from './document-repository.ts'
import { createDraftRepository } from './draft-repository.ts'
import { createGrantRepository } from './grant-repository.ts'
import { createGroupRepository } from './group-repository.ts'
import { createRenderCacheRepository } from './render-cache-repository.ts'
import { createRevisionsIndexRepository } from './revisions-index-repository.ts'
import { createUnitRepository } from './unit-repository.ts'
import { createUserRepository } from './user-repository.ts'
import { createWorkspaceRepository } from './workspace-repository.ts'
import { aShortId } from '@quill/application/test-support'

/**
 * The repositories the M2 content path added, against a real Postgres: the
 * collections a document lives in, the groups a request belongs to, the
 * revisions index history is read from, the render cache, and the link index.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const DOC = documentId('00000000-0000-4000-8000-000000000201')
const CHILD = documentId('00000000-0000-4000-8000-000000000202')
const OTHER = documentId('00000000-0000-4000-8000-000000000203')
const MEMBER = userId('00000000-0000-4000-8000-000000000001')
const STRANGER = userId('00000000-0000-4000-8000-000000000002')

let database: TestDatabase
let collections: ReturnType<typeof createCollectionRepository>
let groups: ReturnType<typeof createGroupRepository>
let revisions: ReturnType<typeof createRevisionsIndexRepository>
let renderCache: ReturnType<typeof createRenderCacheRepository>
let links: ReturnType<typeof createDocumentLinksRepository>
let documents: ReturnType<typeof createDocumentRepository>
let units: ReturnType<typeof createUnitRepository>

const COLLECTION = '00000000-0000-4000-8000-000000000301' as CollectionId

const content = (html: string) => ({
  version: 1,
  html,
  outline: [],
  text: { title: undefined, headings: [], body: '' },
  links: [],
  slots: [],
  incompleteRequiredSections: [],
})

beforeAll(async () => {
  database = await createTestDatabase()
  collections = createCollectionRepository(database.db)
  groups = createGroupRepository(database.db)
  revisions = createRevisionsIndexRepository(database.db)
  renderCache = createRenderCacheRepository(database.db)
  links = createDocumentLinksRepository(database.db)
  documents = createDocumentRepository(database.db)
  units = createUnitRepository(database.db)

  await units.create({
    id: 'acme',
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: NOW,
  })
  await units.create({
    id: 'platform',
    parentId: 'acme',
    name: 'Platform',
    slug: 'platform',
    label: 'team',
    now: NOW,
  })
  await createWorkspaceRepository(database.db).create({
    id: WORKSPACE,
    unitId: 'platform',
    name: 'Engineering',
    slug: 'engineering',
    now: NOW,
  })
  const users = createUserRepository(database.db)
  for (const [id, name] of [
    [MEMBER, 'Member'],
    [STRANGER, 'Stranger'],
  ] as const) {
    await users.create({
      id,
      email: `${name.toLowerCase()}@example.com`,
      displayName: name,
      now: NOW,
    })
  }
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM document_links')
  await database.pool.query('DELETE FROM render_cache')
  await database.pool.query('DELETE FROM revisions_index')
  await database.pool.query('DELETE FROM documents')
  await database.pool.query('DELETE FROM collections')
  await database.pool.query('DELETE FROM group_members')
  await database.pool.query('DELETE FROM groups')
})

async function seedDocuments(): Promise<void> {
  await collections.create({
    id: COLLECTION,
    workspaceId: WORKSPACE,
    name: 'Architecture',
    slug: 'architecture',
    now: NOW,
  })
  for (const [index, [id, parentId, slug]] of (
    [
      [DOC, null, 'parent'],
      [CHILD, DOC, 'child'],
      [OTHER, null, 'other'],
    ] as const
  ).entries()) {
    await documents.create({
      id,
      shortId: aShortId(index + 1),
      workspaceId: WORKSPACE,
      collectionId: COLLECTION,
      parentId,
      slug,
      path: `architecture/${slug}.md`,
      title: slug,
      status: 'draft',
      templateId: null,
      templateVersion: null,
      now: NOW,
    })
  }
}

describe('CollectionRepository', () => {
  it('creates, finds by id and slug, and lists a workspace by name', async () => {
    const architecture = await collections.create({
      id: COLLECTION,
      workspaceId: WORKSPACE,
      name: 'Architecture',
      slug: 'architecture',
      now: NOW,
    })
    const runbooks = await collections.create({
      id: '00000000-0000-4000-8000-000000000302' as CollectionId,
      workspaceId: WORKSPACE,
      name: 'Runbooks',
      slug: 'runbooks',
      now: NOW,
    })

    expect(await collections.findById(COLLECTION)).toEqual(architecture)
    expect(await collections.findById('nope' as CollectionId)).toBeNull()
    expect(await collections.findBySlug(WORKSPACE, 'runbooks')).toEqual(runbooks)
    expect(await collections.findBySlug(WORKSPACE, 'nope')).toBeNull()
    expect((await collections.listByWorkspace(WORKSPACE)).map((row) => row.name)).toEqual([
      'Architecture',
      'Runbooks',
    ])
  })
})

describe('GroupRepository', () => {
  it('walks a membership up to the groups it nests inside, in one query', async () => {
    await groups.create({
      id: 'engineering' as GroupId,
      unitId: 'acme',
      parentGroupId: null,
      name: 'Engineering',
      now: NOW,
    })
    await groups.create({
      id: 'platform-group' as GroupId,
      unitId: 'acme',
      parentGroupId: 'engineering' as GroupId,
      name: 'Platform',
      now: NOW,
    })

    expect((await groups.findById('platform-group' as GroupId))?.parentGroupId).toBe('engineering')
    expect(await groups.findById('nope' as GroupId)).toBeNull()

    await groups.addMember({ groupId: 'platform-group' as GroupId, userId: MEMBER, now: NOW })
    // Adding the same membership twice is not an error.
    await groups.addMember({ groupId: 'platform-group' as GroupId, userId: MEMBER, now: NOW })
    expect((await groups.listForUser(MEMBER)).map((row) => row.id).toSorted()).toEqual([
      'engineering',
      'platform-group',
    ])
    expect(await groups.listForUser(STRANGER)).toEqual([])

    await groups.removeMember({ groupId: 'platform-group' as GroupId, userId: MEMBER })
    expect(await groups.listForUser(MEMBER)).toEqual([])
  })
})

describe('DocumentRepository: ancestry and batched reads', () => {
  it('walks a document to the root and reads a set of ids at once', async () => {
    await seedDocuments()

    expect((await documents.listAncestors(CHILD)).map((row) => row.id)).toEqual([CHILD, DOC])
    expect(
      await documents.listAncestors(documentId('00000000-0000-4000-8000-0000000002ff')),
    ).toEqual([])
    expect((await documents.listByIds([DOC, OTHER])).map((row) => row.id).toSorted()).toEqual(
      [DOC, OTHER].toSorted(),
    )
    expect(await documents.listByIds([])).toEqual([])
  })
})

describe('UnitRepository: ancestry', () => {
  it('walks a unit to the root of the tree', async () => {
    expect((await units.listAncestors('platform')).map((row) => row.id)).toEqual([
      'platform',
      'acme',
    ])
    expect(await units.listAncestors('nope')).toEqual([])
  })
})

describe('RevisionsIndexRepository', () => {
  it('pages a document newest first, resuming exactly after the cursor', async () => {
    await seedDocuments()
    for (let index = 0; index < 4; index++) {
      await revisions.append({
        id: `revision-${index}`,
        documentId: DOC,
        workspaceId: WORKSPACE,
        revision: revisionId(index.toString(16).padStart(40, '0')),
        authorName: 'Ada',
        authorEmail: 'ada@example.com',
        timestamp: new Date(NOW.getTime() + index * 1000),
        summary: `Revision ${index}`,
        changeNote: index === 0 ? null : `note ${index}`,
        now: NOW,
      })
    }
    await revisions.append({
      id: 'other-document',
      documentId: OTHER,
      workspaceId: WORKSPACE,
      revision: revisionId('f'.repeat(40)),
      authorName: 'Ada',
      authorEmail: 'ada@example.com',
      timestamp: NOW,
      summary: 'Elsewhere',
      changeNote: null,
      now: NOW,
    })

    const first = await revisions.listForDocument(DOC, { limit: 2 })
    expect(first.map((row) => row.summary)).toEqual(['Revision 3', 'Revision 2'])
    const second = await revisions.listForDocument(DOC, { limit: 2, cursor: 'revision-2' })
    expect(second.map((row) => row.summary)).toEqual(['Revision 1', 'Revision 0'])
    expect((await revisions.latestForDocument(DOC))?.summary).toBe('Revision 3')
    expect(await revisions.latestForDocument(CHILD)).toBeNull()
  })

  it('records one row per revision however often a publish is retried', async () => {
    await seedDocuments()
    const entry = {
      documentId: DOC,
      workspaceId: WORKSPACE,
      revision: revisionId('a'.repeat(40)),
      authorName: 'Ada',
      authorEmail: 'ada@example.com',
      timestamp: NOW,
      summary: 'The first pass',
      changeNote: null,
      now: NOW,
    }
    const first = await revisions.append({ ...entry, id: 'revision-first' })

    // A publish whose content reached the store and whose record did not is
    // retried with a fresh id; the row that is already there is what comes
    // back, and history still shows one entry (ADR-015).
    const again = await revisions.append({
      ...entry,
      id: 'revision-retry',
      summary: 'The same pass, retried',
    })
    expect(again).toEqual(first)
    expect(await revisions.listForDocument(DOC, { limit: 10 })).toHaveLength(1)

    // The same revision under another document is a different row: the
    // constraint is on the pair, because one publish can touch many documents.
    expect(
      await revisions.append({ ...entry, id: 'revision-other', documentId: OTHER }),
    ).toMatchObject({ id: 'revision-other' })
  })

  it('breaks a tie on the timestamp by identifier, so a page never repeats a row', async () => {
    await seedDocuments()
    for (const id of ['revision-a', 'revision-b', 'revision-c']) {
      await revisions.append({
        id,
        documentId: DOC,
        workspaceId: WORKSPACE,
        revision: revisionId(id.charCodeAt(9).toString(16).padStart(40, '0')),
        authorName: 'Ada',
        authorEmail: 'ada@example.com',
        timestamp: NOW,
        summary: id,
        changeNote: null,
        now: NOW,
      })
    }

    const page = await revisions.listForDocument(DOC, { limit: 2 })
    expect(page.map((row) => row.id)).toEqual(['revision-c', 'revision-b'])
    expect(
      (await revisions.listForDocument(DOC, { limit: 2, cursor: 'revision-b' })).map(
        (row) => row.id,
      ),
    ).toEqual(['revision-a'])
  })
})

describe('DraftRepository and GrantRepository: the empty cases', () => {
  it('reports a draft that cannot be rebased and asks nothing for an empty scope chain', async () => {
    const drafts = createDraftRepository(database.db, database.pool)
    expect(await drafts.rebase({ documentId: DOC, baseRevision: null, now: NOW })).toBeNull()
    expect(
      await createGrantRepository(database.db, createUuidGenerator()).listForScopes([]),
    ).toEqual([])
  })
})

describe('RenderCacheRepository', () => {
  it('saves an entry, stamps every read, and replaces it in place', async () => {
    await seedDocuments()
    await renderCache.save({
      key: 'hash:1',
      documentId: DOC,
      contentHash: 'hash',
      renderVersion: 1,
      content: content('<p>First</p>'),
      now: NOW,
    })

    const later = new Date(NOW.getTime() + 60_000)
    const found = await renderCache.find('hash:1', later)
    expect(found).toMatchObject({ lastReadAt: later })
    expect(found?.content.html).toBe('<p>First</p>')
    expect(await renderCache.find('missing:1', later)).toBeNull()

    await renderCache.save({
      key: 'hash:1',
      documentId: DOC,
      contentHash: 'hash',
      renderVersion: 1,
      content: content('<p>Second</p>'),
      now: later,
    })
    expect((await renderCache.find('hash:1', later))?.content.html).toBe('<p>Second</p>')
  })
})

describe('DocumentLinksRepository', () => {
  it('replaces the links of a document and finds what points at one', async () => {
    await seedDocuments()
    await links.replaceForDocument({
      documentId: DOC,
      links: [
        { targetDocumentId: CHILD, url: `/d/${CHILD}`, text: 'Child', kind: 'document' },
        { targetDocumentId: null, url: 'https://example.com', text: 'Web', kind: 'external' },
      ],
      idFor: (index) => `link-${index}`,
    })
    await links.replaceForDocument({
      documentId: OTHER,
      links: [{ targetDocumentId: CHILD, url: `/d/${CHILD}`, text: 'Child', kind: 'document' }],
      idFor: () => 'other-link',
    })

    expect((await links.listForDocument(DOC)).map((row) => row.kind)).toEqual([
      'document',
      'external',
    ])
    expect((await links.listSourcesTargeting(CHILD)).toSorted()).toEqual([DOC, OTHER].toSorted())

    await links.replaceForDocument({ documentId: DOC, links: [], idFor: () => 'unused' })
    expect(await links.listForDocument(DOC)).toEqual([])
    expect(await links.listSourcesTargeting(CHILD)).toEqual([OTHER])
  })

  it('forgets a target that is deleted, leaving the link broken rather than the row gone', async () => {
    await seedDocuments()
    await links.replaceForDocument({
      documentId: DOC,
      links: [{ targetDocumentId: CHILD, url: `/d/${CHILD}`, text: 'Child', kind: 'document' }],
      idFor: () => 'link-0',
    })

    await documents.delete(CHILD)
    const [row] = await links.listForDocument(DOC)
    expect(row).toMatchObject({ kind: 'document', targetDocumentId: null })
  })
})
