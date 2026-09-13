import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { documentId, workspaceId } from '@quill/domain'
import { aShortId } from '@quill/application/test-support'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createDocumentRepository } from './document-repository.ts'
import { createUnitRepository } from './unit-repository.ts'
import { createWorkspaceRepository } from './workspace-repository.ts'

let database: TestDatabase
let documents: ReturnType<typeof createDocumentRepository>
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000001')
const DOC = documentId('00000000-0000-4000-8000-0000000000d1')

beforeAll(async () => {
  database = await createTestDatabase()
  documents = createDocumentRepository(database.db)
  const now = new Date('2026-01-01T00:00:00.000Z')
  await createUnitRepository(database.db).create({
    id: 'unit-1',
    parentId: null,
    name: 'Unit',
    slug: 'unit',
    label: 'unit',
    now,
  })
  await createWorkspaceRepository(database.db).create({
    id: WORKSPACE,
    unitId: 'unit-1',
    name: 'Workspace',
    slug: 'workspace',
    now,
  })
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM documents')
})

function baseInput(now: Date) {
  return {
    id: DOC,
    shortId: aShortId(),
    workspaceId: WORKSPACE,
    collectionId: null,
    parentId: null,
    slug: 'getting-started',
    path: '/getting-started',
    title: 'Getting started',
    status: 'draft' as const,
    templateId: null,
    templateVersion: null,
    now,
  }
}

describe('DocumentRepository: claiming a path and a key', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')
  const OTHER = documentId('00000000-0000-4000-8000-0000000000d2')

  it('creates a document when its path is free and says so when it is taken', async () => {
    const created = await documents.createIfAvailable(baseInput(now))
    expect(created).toMatchObject({
      kind: 'created',
      document: { id: DOC, path: '/getting-started' },
    })

    // The unique `(workspace_id, path)` index decides, not a probe: the second
    // caller is told the path is gone rather than failing, so it can try the
    // next candidate.
    expect(
      await documents.createIfAvailable({
        ...baseInput(now),
        id: OTHER,
        shortId: aShortId(2),
      }),
    ).toEqual({ kind: 'path-taken' })

    expect(
      await documents.createIfAvailable({
        ...baseInput(now),
        id: OTHER,
        shortId: aShortId(2),
        slug: 'getting-started-2',
        path: '/getting-started-2',
      }),
    ).toMatchObject({ kind: 'created', document: { id: OTHER, path: '/getting-started-2' } })
  })

  it('tells a taken key apart from a taken path, so the caller knows to draw again', async () => {
    await documents.createIfAvailable(baseInput(now))

    // Free path, key already held: the unique `short_id` index refuses it
    // (ADR-035), and the answer says which of the two it was.
    expect(
      await documents.createIfAvailable({
        ...baseInput(now),
        id: OTHER,
        slug: 'elsewhere',
        path: '/elsewhere',
      }),
    ).toEqual({ kind: 'short-id-taken' })
  })

  it('finds a document by its key, one at a time and in bulk', async () => {
    await documents.create(baseInput(now))
    await documents.create({
      ...baseInput(now),
      id: OTHER,
      shortId: aShortId(2),
      slug: 'elsewhere',
      path: '/elsewhere',
    })

    expect(await documents.findByShortId(aShortId())).toMatchObject({ id: DOC })
    expect(await documents.findByShortId(aShortId(99))).toBeNull()
    expect(
      (await documents.listByShortIds([aShortId(), aShortId(2), aShortId(99)])).map(
        (row) => row.id,
      ),
    ).toEqual(expect.arrayContaining([DOC, OTHER]))
    expect(await documents.listByShortIds([])).toEqual([])
  })
})

describe('DocumentRepository', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')

  it('creates a document and finds it by id and by path', async () => {
    const created = await documents.create(baseInput(now))
    expect(created).toEqual({
      id: DOC,
      shortId: aShortId(),
      workspaceId: WORKSPACE,
      collectionId: null,
      parentId: null,
      slug: 'getting-started',
      path: '/getting-started',
      title: 'Getting started',
      status: 'draft',
      templateId: null,
      templateVersion: null,
      headRevision: null,
      createdAt: now,
      updatedAt: now,
    })
    expect(await documents.findById(DOC)).toEqual(created)
    expect(await documents.findByPath(WORKSPACE, '/getting-started')).toEqual(created)
  })

  it('returns null for an unknown id or path', async () => {
    expect(await documents.findById(documentId('00000000-0000-4000-8000-000000000099'))).toBeNull()
    expect(await documents.findByPath(WORKSPACE, '/nope')).toBeNull()
  })

  it('lists documents by workspace', async () => {
    await documents.create(baseInput(now))
    const list = await documents.listByWorkspace(WORKSPACE)
    expect(list.map((doc) => doc.id)).toEqual([DOC])
  })

  it('updates a partial patch and bumps updatedAt', async () => {
    await documents.create(baseInput(now))
    const later = new Date('2026-01-02T00:00:00.000Z')
    const updated = await documents.update(DOC, { title: 'New title', status: 'published' }, later)
    expect(updated.title).toBe('New title')
    expect(updated.status).toBe('published')
    expect(updated.slug).toBe('getting-started')
    expect(updated.updatedAt).toEqual(later)
  })

  it('throws when updating a document that does not exist', async () => {
    await expect(
      documents.update(documentId('00000000-0000-4000-8000-000000000099'), {}, now),
    ).rejects.toThrow('update: document not found')
  })

  it('deletes a document', async () => {
    await documents.create(baseInput(now))
    await documents.delete(DOC)
    expect(await documents.findById(DOC)).toBeNull()
  })
})
