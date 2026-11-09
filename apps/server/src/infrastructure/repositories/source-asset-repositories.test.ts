import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userId, workspaceId } from '@quill/domain'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createAttachmentRepository } from './attachment-repository.ts'
import { createSourceAssetRepository } from './source-sync-repositories.ts'
import { createUnitRepository } from './unit-repository.ts'
import { createUserRepository } from './user-repository.ts'
import { createWorkspaceRepository } from './workspace-repository.ts'
import { createWorkspaceSourceRepository } from './workspace-source-repository.ts'

/** A sourced workspace's repository assets (ADR-061), against a real Postgres. */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const LATER = new Date('2026-01-02T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const OTHER = workspaceId('00000000-0000-4000-8000-000000000102')
const ADMIN = userId('00000000-0000-4000-8000-000000000001')
const FIRST = '00000000-0000-4000-8000-000000000301'
const SECOND = '00000000-0000-4000-8000-000000000302'

let database: TestDatabase
let attachments: ReturnType<typeof createAttachmentRepository>
let assets: ReturnType<typeof createSourceAssetRepository>

const asset = (id: string, workspace = WORKSPACE, sha256 = 'a'.repeat(64)) => ({
  id,
  workspaceId: workspace,
  filename: 'flow.png',
  contentType: 'image/png',
  size: 12,
  sha256,
  searchText: null,
  now: NOW,
})

beforeAll(async () => {
  database = await createTestDatabase()
  attachments = createAttachmentRepository(database.db)
  assets = createSourceAssetRepository(database.db)
  await createUnitRepository(database.db).create({
    id: 'acme',
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: NOW,
  })
  await createUserRepository(database.db).create({
    id: ADMIN,
    email: 'admin@example.com',
    displayName: 'Admin',
    now: NOW,
  })
  const workspaces = createWorkspaceRepository(database.db)
  const sources = createWorkspaceSourceRepository(database.db)
  for (const [id, slug] of [
    [WORKSPACE, 'handbook'],
    [OTHER, 'other'],
  ] as const) {
    await workspaces.create({ id, unitId: 'acme', name: slug, slug, now: NOW })
    await sources.put({
      workspaceId: id,
      remote: 'https://github.com/acme/handbook.git',
      branch: 'main',
      collections: [],
      history: 'full',
      commitMessages: 'subject',
      credential: null,
      webhookSecretName: null,
      outsideLinks: 'forge',
      viewTemplate: null,
      configuredBy: ADMIN,
      now: NOW,
    })
  }
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM source_assets')
  await database.pool.query('DELETE FROM attachments')
})

describe('the source’s attachments', () => {
  it('belong to the source, not a document, and are found by their bytes', async () => {
    const created = await attachments.createForSource(asset(FIRST))
    expect(created).toMatchObject({
      id: FIRST,
      documentId: null,
      sourceWorkspaceId: WORKSPACE,
      workspaceId: WORKSPACE,
      uploadedBy: null,
      version: 1,
      deletedAt: null,
    })
    await attachments.createForSource(asset(SECOND, OTHER))

    expect((await attachments.findSourceOwned(WORKSPACE, 'a'.repeat(64)))?.id).toBe(FIRST)
    expect(await attachments.findSourceOwned(WORKSPACE, 'b'.repeat(64))).toBeNull()
    expect((await attachments.listSourceOwned(WORKSPACE)).map(({ id }) => id)).toEqual([FIRST])

    await attachments.softDelete(FIRST, LATER)
    expect(await attachments.findSourceOwned(WORKSPACE, 'a'.repeat(64))).toBeNull()
    expect(await attachments.listSourceOwned(WORKSPACE)).toEqual([])
  })

  it('has exactly one owner, a document or a source', async () => {
    await expect(
      database.pool.query(
        `INSERT INTO attachments (id, workspace_id, filename, content_type, size, sha256, created_at)
         VALUES ($1, $2, 'x.png', 'image/png', 1, 'c', $3)`,
        [FIRST, WORKSPACE, NOW],
      ),
    ).rejects.toThrow(/attachments_owner_check/)
  })
})

describe('the asset map', () => {
  it('holds one attachment per path, written whole, and lists it by path', async () => {
    await attachments.createForSource(asset(FIRST))
    await attachments.createForSource(asset(SECOND, WORKSPACE, 'b'.repeat(64)))
    const row = { workspaceId: WORKSPACE, path: 'docs/flow.png', attachmentId: FIRST, fileId: 'f1' }
    await assets.put(row, NOW)
    await assets.put({ ...row, path: 'docs/copy.png' }, NOW)
    await assets.put({ ...row, attachmentId: SECOND, fileId: 'f2' }, LATER)

    expect(
      (await assets.listByWorkspace(WORKSPACE)).toSorted((a, b) => a.path.localeCompare(b.path)),
    ).toEqual([
      { ...row, path: 'docs/copy.png' },
      { ...row, attachmentId: SECOND, fileId: 'f2' },
    ])
    expect(await assets.listByPaths(WORKSPACE, ['docs/flow.png', 'docs/none.png'])).toEqual([
      { ...row, attachmentId: SECOND, fileId: 'f2' },
    ])
    expect(await assets.listByPaths(WORKSPACE, [])).toEqual([])
    expect(await assets.listByWorkspace(OTHER)).toEqual([])

    await assets.remove(WORKSPACE, 'docs/copy.png')
    expect((await assets.listByWorkspace(WORKSPACE)).map(({ path }) => path)).toEqual([
      'docs/flow.png',
    ])
  })
})
