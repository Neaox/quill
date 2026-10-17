import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { documentId, revisionId, userId, workspaceId } from '@quill/domain'
import { aShortId } from '@quill/application/test-support'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createDocumentRepository } from './document-repository.ts'
import { createDocumentViewRepository } from './document-view-repository.ts'
import { createRevisionsIndexRepository } from './revisions-index-repository.ts'
import { createUnitRepository } from './unit-repository.ts'
import { createUserRepository } from './user-repository.ts'
import { createWorkspaceRepository } from './workspace-repository.ts'

let database: TestDatabase
let views: ReturnType<typeof createDocumentViewRepository>
let documents: ReturnType<typeof createDocumentRepository>

const ADA = userId('00000000-0000-4000-8000-000000000001')
const GRACE = userId('00000000-0000-4000-8000-000000000002')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const OTHER_WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000102')
const DOC = documentId('00000000-0000-4000-8000-0000000000d1')
const OTHER_DOC = documentId('00000000-0000-4000-8000-0000000000d2')
const START = new Date('2026-10-13T12:00:00.000Z')
const minutes = (count: number) => new Date(START.getTime() + count * 60_000)
const EVER = new Date(0)

beforeAll(async () => {
  database = await createTestDatabase()
  views = createDocumentViewRepository(database.db)
  documents = createDocumentRepository(database.db)
  await createUnitRepository(database.db).create({
    id: 'unit-1',
    parentId: null,
    name: 'Unit',
    slug: 'unit',
    label: 'unit',
    now: START,
  })
  const workspaces = createWorkspaceRepository(database.db)
  await workspaces.create({ id: WORKSPACE, unitId: 'unit-1', name: 'One', slug: 'one', now: START })
  await workspaces.create({
    id: OTHER_WORKSPACE,
    unitId: 'unit-1',
    name: 'Two',
    slug: 'two',
    now: START,
  })
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM documents')
  await database.pool.query('DELETE FROM users')
  const users = createUserRepository(database.db)
  await users.create({ id: ADA, email: 'ada@example.com', displayName: 'Ada', now: START })
  await users.create({ id: GRACE, email: 'grace@example.com', displayName: 'Grace', now: START })
  const base = {
    collectionId: null,
    parentId: null,
    status: 'draft' as const,
    templateId: null,
    templateVersion: null,
    now: START,
  }
  await documents.create({
    ...base,
    id: DOC,
    shortId: aShortId(1),
    workspaceId: WORKSPACE,
    slug: 'a',
    path: '/a',
    title: 'A',
  })
  await documents.create({
    ...base,
    id: OTHER_DOC,
    shortId: aShortId(2),
    workspaceId: OTHER_WORKSPACE,
    slug: 'b',
    path: '/b',
    title: 'B',
  })
})

const touch = (user = ADA, document = DOC, workspace = WORKSPACE, now = START) =>
  views.touch({
    userId: user,
    documentId: document,
    workspaceId: workspace,
    now,
    debounceBefore: new Date(now.getTime() - 5 * 60_000),
  })

const recent = (user = ADA, since = EVER, limit = 10) =>
  views.listRecent({ userId: user, since, limit })

describe('DocumentViewRepository.touch', () => {
  it('inserts the first view', async () => {
    expect(await touch()).toBe(true)
    expect(await recent()).toEqual([
      { userId: ADA, documentId: DOC, workspaceId: WORKSPACE, lastViewedAt: START, views: 1 },
    ])
  })

  it('leaves the row alone inside the window and counts it after', async () => {
    await touch()

    expect(await touch(ADA, DOC, WORKSPACE, minutes(4))).toBe(false)
    expect(await touch(ADA, DOC, WORKSPACE, minutes(6))).toBe(true)
    expect(await recent()).toMatchObject([{ lastViewedAt: minutes(6), views: 2 }])
  })

  it('keeps one row per person and document', async () => {
    await touch(ADA)
    await touch(GRACE)

    expect(await recent(ADA)).toHaveLength(1)
    expect(await recent(GRACE)).toHaveLength(1)
  })
})

describe('DocumentViewRepository reads', () => {
  it('lists newest first, cut at the limit and the window', async () => {
    await touch(ADA, DOC, WORKSPACE, minutes(0))
    await touch(ADA, OTHER_DOC, OTHER_WORKSPACE, minutes(10))

    expect((await recent()).map((row) => row.documentId)).toEqual([OTHER_DOC, DOC])
    expect((await recent(ADA, EVER, 1)).map((row) => row.documentId)).toEqual([OTHER_DOC])
    expect((await recent(ADA, minutes(5))).map((row) => row.documentId)).toEqual([OTHER_DOC])
  })

  it('sums a person’s views per workspace, inside the window', async () => {
    await touch(ADA, DOC, WORKSPACE, minutes(0))
    await touch(ADA, DOC, WORKSPACE, minutes(10))
    await touch(ADA, OTHER_DOC, OTHER_WORKSPACE, minutes(20))
    await touch(GRACE, DOC, WORKSPACE, minutes(0))

    const sums = await views.sumByWorkspace({ userId: ADA, since: EVER })
    expect(sums.toSorted((a, b) => a.workspaceId.localeCompare(b.workspaceId))).toEqual([
      { workspaceId: WORKSPACE, views: 2 },
      { workspaceId: OTHER_WORKSPACE, views: 1 },
    ])
    expect(await views.sumByWorkspace({ userId: ADA, since: minutes(15) })).toEqual([
      { workspaceId: OTHER_WORKSPACE, views: 1 },
    ])
  })
})

describe('DocumentViewRepository deletes', () => {
  it('forgets one person and nobody else', async () => {
    await touch(ADA)
    await touch(GRACE)

    expect(await views.deleteForUser(ADA)).toBe(1)
    expect(await recent(ADA)).toEqual([])
    expect(await recent(GRACE)).toHaveLength(1)
  })

  it('removes everything older than a cutoff, for everybody', async () => {
    await touch(ADA, DOC, WORKSPACE, minutes(0))
    await touch(GRACE, DOC, WORKSPACE, minutes(30))

    expect(await views.deleteOlderThan(minutes(10))).toBe(1)
    expect(await recent(ADA)).toEqual([])
    expect(await recent(GRACE)).toHaveLength(1)
  })

  it('goes with the document and with the person', async () => {
    await touch(ADA, DOC)
    await touch(GRACE, OTHER_DOC, OTHER_WORKSPACE)

    await documents.delete(DOC)
    expect(await recent(ADA)).toEqual([])

    await database.pool.query('DELETE FROM users WHERE id = $1', [GRACE])
    expect(await recent(GRACE)).toEqual([])
  })
})

describe('authorship columns', () => {
  it('stores who created and last changed a document, null until recorded', async () => {
    expect(await documents.findById(DOC)).toMatchObject({ createdBy: null, updatedBy: null })

    const created = await documents.create({
      id: documentId('00000000-0000-4000-8000-0000000000d3'),
      shortId: aShortId(3),
      workspaceId: WORKSPACE,
      collectionId: null,
      parentId: null,
      slug: 'c',
      path: '/c',
      title: 'C',
      status: 'draft',
      templateId: null,
      templateVersion: null,
      createdBy: ADA,
      now: START,
    })
    expect(created).toMatchObject({ createdBy: ADA, updatedBy: null })

    const updated = await documents.update(created.id, { updatedBy: GRACE }, minutes(1))
    expect(updated).toMatchObject({ createdBy: ADA, updatedBy: GRACE })
    expect(await documents.listByWorkspace(WORKSPACE)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.id, createdBy: ADA })]),
    )
    expect((await documents.listAncestors(created.id))[0]).toMatchObject({
      createdBy: ADA,
      updatedBy: GRACE,
    })
  })

  it('stores the publisher’s id on the revision index', async () => {
    const revisions = createRevisionsIndexRepository(database.db)
    const entry = {
      id: 'revision-1',
      documentId: DOC,
      workspaceId: WORKSPACE,
      revision: revisionId('a'.repeat(40)),
      authorName: 'Ada',
      authorEmail: 'ada@example.com',
      timestamp: START,
      summary: 'A',
      changeNote: null,
      now: START,
    }
    expect(await revisions.append({ ...entry, authorUserId: ADA })).toMatchObject({
      authorUserId: ADA,
    })
    expect(
      await revisions.append({ ...entry, id: 'revision-2', revision: revisionId('b'.repeat(40)) }),
    ).toMatchObject({ authorUserId: null })
  })
})
