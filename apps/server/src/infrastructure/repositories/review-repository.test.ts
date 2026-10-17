import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { documentId, userId, workspaceId } from '@quill/domain'
import { aShortId } from '@quill/application/test-support'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createDocumentRepository } from './document-repository.ts'
import { createReviewRepository } from './review-repository.ts'
import { createUnitRepository } from './unit-repository.ts'
import { createUserRepository } from './user-repository.ts'
import { createWorkspaceRepository } from './workspace-repository.ts'

let database: TestDatabase
let reviews: ReturnType<typeof createReviewRepository>
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000001')
const DOC = documentId('00000000-0000-4000-8000-0000000000d1')
const ASKER = userId('00000000-0000-4000-8000-0000000000a1')
const NOW = new Date('2026-01-01T00:00:00.000Z')

beforeAll(async () => {
  database = await createTestDatabase()
  reviews = createReviewRepository(database.db)
  await createUserRepository(database.db).create({
    id: ASKER,
    email: 'asker@example.com',
    displayName: 'Asker',
    now: NOW,
  })
  await createUnitRepository(database.db).create({
    id: 'unit-1',
    parentId: null,
    name: 'Unit',
    slug: 'unit',
    label: 'unit',
    now: NOW,
  })
  await createWorkspaceRepository(database.db).create({
    id: WORKSPACE,
    unitId: 'unit-1',
    name: 'Workspace',
    slug: 'workspace',
    now: NOW,
  })
  await createDocumentRepository(database.db).createIfAvailable({
    id: DOC,
    shortId: aShortId(),
    workspaceId: WORKSPACE,
    collectionId: null,
    parentId: null,
    slug: 'plan',
    path: '/plan',
    title: 'Plan',
    status: 'draft',
    templateId: null,
    templateVersion: null,
    now: NOW,
  })
}, 30_000)

afterAll(async () => {
  await database.drop()
})

describe('ReviewRepository: what is not there', () => {
  it('answers null for a request, an active request and a latest request that do not exist', async () => {
    expect(await reviews.findById('missing')).toBeNull()
    expect(await reviews.findActiveForDocument(DOC)).toBeNull()
    expect(await reviews.findLatestForDocument(DOC)).toBeNull()
  })

  it('answers null when asked to move a request that does not exist to a status', async () => {
    expect(await reviews.setStatus('missing', 'withdrawn', NOW)).toBeNull()
  })

  it('writes nothing when a decision names no assignments', async () => {
    await expect(
      reviews.recordDecision({
        assignmentIds: [],
        state: 'approved',
        decidedBy: ASKER,
        comment: null,
        now: NOW,
      }),
    ).resolves.toBeUndefined()
  })
})

describe('ReviewRepository: a request with nobody named yet', () => {
  it('stores the request with no assignments', async () => {
    const created = await reviews.create({
      id: 'request-1',
      documentId: DOC,
      requestedBy: ASKER,
      draftVersion: 1,
      message: null,
      reviewers: [],
      now: NOW,
    })
    expect(created).toMatchObject({ id: 'request-1', status: 'open', closedAt: null })
    expect(await reviews.listAssignments(['request-1'])).toEqual([])
  })
})
