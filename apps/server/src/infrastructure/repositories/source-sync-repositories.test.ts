import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { documentId, workspaceId } from '@quill/domain'
import { aShortId } from '@quill/application/test-support'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createDocumentRepository } from './document-repository.ts'
import {
  createSourcePathMapRepository,
  createSourceSyncStateRepository,
} from './source-sync-repositories.ts'
import { createUnitRepository } from './unit-repository.ts'
import { createWorkspaceRepository } from './workspace-repository.ts'

/** The sync job's tables (ADR-061), against a real Postgres. */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const LATER = new Date('2026-01-02T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const OTHER_WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000102')
const A = documentId('00000000-0000-4000-8000-000000000201')
const B = documentId('00000000-0000-4000-8000-000000000202')

let database: TestDatabase
let paths: ReturnType<typeof createSourcePathMapRepository>
let states: ReturnType<typeof createSourceSyncStateRepository>

beforeAll(async () => {
  database = await createTestDatabase()
  paths = createSourcePathMapRepository(database.db)
  states = createSourceSyncStateRepository(database.db)
  await createUnitRepository(database.db).create({
    id: 'acme',
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: NOW,
  })
  const workspaces = createWorkspaceRepository(database.db)
  for (const [id, slug] of [
    [WORKSPACE, 'handbook'],
    [OTHER_WORKSPACE, 'other'],
  ] as const) {
    await workspaces.create({ id, unitId: 'acme', name: slug, slug, now: NOW })
  }
  const documents = createDocumentRepository(database.db)
  for (const [index, id] of [A, B].entries()) {
    await documents.create({
      id,
      shortId: aShortId(index + 1),
      workspaceId: WORKSPACE,
      collectionId: null,
      parentId: null,
      slug: `doc-${index}`,
      path: `docs/${index}.md`,
      title: `Doc ${index}`,
      status: 'published',
      templateId: null,
      templateVersion: null,
      now: NOW,
    })
  }
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM source_path_map')
  await database.pool.query('DELETE FROM source_sync_state')
})

describe('the source path map', () => {
  it('keeps one entry per path of a workspace, written whole', async () => {
    await paths.put(
      { workspaceId: WORKSPACE, path: 'docs/a.md', documentId: A, archivedAt: null, order: null },
      NOW,
    )
    await paths.put(
      { workspaceId: WORKSPACE, path: 'docs/b.md', documentId: B, archivedAt: null, order: 3 },
      NOW,
    )
    await paths.put(
      { workspaceId: WORKSPACE, path: 'docs/a.md', documentId: A, archivedAt: LATER, order: null },
      LATER,
    )

    const rows = await paths.listByWorkspace(WORKSPACE)
    expect(rows.toSorted((left, right) => left.path.localeCompare(right.path))).toEqual([
      { workspaceId: WORKSPACE, path: 'docs/a.md', documentId: A, archivedAt: LATER, order: null },
      { workspaceId: WORKSPACE, path: 'docs/b.md', documentId: B, archivedAt: null, order: 3 },
    ])
    expect(await paths.listByWorkspace(OTHER_WORKSPACE)).toEqual([])
  })

  it('moves a document by forgetting its old path and writing its new one', async () => {
    await paths.put(
      { workspaceId: WORKSPACE, path: 'docs/a.md', documentId: A, archivedAt: null, order: null },
      NOW,
    )
    await paths.remove(WORKSPACE, 'docs/a.md')
    await paths.put(
      { workspaceId: WORKSPACE, path: 'docs/z.md', documentId: A, archivedAt: null, order: null },
      NOW,
    )
    expect((await paths.listByWorkspace(WORKSPACE)).map((row) => row.path)).toEqual(['docs/z.md'])
  })

  it('refuses one document at two paths', async () => {
    await paths.put(
      { workspaceId: WORKSPACE, path: 'docs/a.md', documentId: A, archivedAt: null, order: null },
      NOW,
    )
    await expect(
      paths.put(
        {
          workspaceId: WORKSPACE,
          path: 'docs/copy.md',
          documentId: A,
          archivedAt: null,
          order: null,
        },
        NOW,
      ),
    ).rejects.toThrow(/Failed query: insert into "source_path_map"/)
  })
})

describe('the source sync state', () => {
  const refused = [{ path: 'docs/huge.md', revision: 'c1', reason: 'too-large' as const }]
  const layout = {
    origin: 'manifest' as const,
    fingerprint: '{"origin":"manifest"}',
    collectionIds: ['collection-1'],
    unknownKeys: [{ key: 'owner', line: 2 }],
  }

  it('has nothing for a workspace that never synced', async () => {
    expect(await states.find(WORKSPACE)).toBeNull()
  })

  it('records a sync, then a failure that keeps it, then a sync that clears the failure', async () => {
    await states.recordSynced({ workspaceId: WORKSPACE, revision: 'c1', refused, layout, now: NOW })
    expect(await states.find(WORKSPACE)).toEqual({
      workspaceId: WORKSPACE,
      lastSyncedRevision: 'c1',
      lastSyncedAt: NOW,
      lastAttemptAt: NOW,
      failure: null,
      refused,
      layout,
    })

    const failure = { reason: 'timeout' as const, message: 'Too slow', revision: 'c2' }
    await states.recordFailure({ workspaceId: WORKSPACE, failure, now: LATER })
    expect(await states.find(WORKSPACE)).toEqual({
      workspaceId: WORKSPACE,
      lastSyncedRevision: 'c1',
      lastSyncedAt: NOW,
      lastAttemptAt: LATER,
      failure,
      refused,
      layout,
    })

    await states.recordSynced({
      workspaceId: WORKSPACE,
      revision: 'c2',
      refused: [],
      layout: { ...layout, origin: 'settings', collectionIds: [], unknownKeys: [] },
      now: LATER,
    })
    expect(await states.find(WORKSPACE)).toMatchObject({
      lastSyncedRevision: 'c2',
      failure: null,
      refused: [],
      layout: { origin: 'settings', collectionIds: [] },
    })
  })

  it('records a failure before any sync, with no revision', async () => {
    await states.recordFailure({
      workspaceId: WORKSPACE,
      failure: { reason: 'git-unavailable', message: 'No git', revision: null },
      now: NOW,
    })
    expect(await states.find(WORKSPACE)).toEqual({
      workspaceId: WORKSPACE,
      lastSyncedRevision: null,
      lastSyncedAt: null,
      lastAttemptAt: NOW,
      failure: { reason: 'git-unavailable', message: 'No git', revision: null },
      refused: [],
      layout: null,
    })
  })

  it('reads documents this release cannot as no failure, nothing refused and no layout', async () => {
    for (const [failure, refusedDocument, layoutDocument] of [
      ['{"version":2,"reason":"x","message":"y"}', '{"version":2,"files":[]}', null],
      ['{"version":1,"reason":7,"message":"y"}', '{"version":1,"files":"none"}', '{"version":2}'],
      ['{"version":1,"reason":"x","message":7}', '[]', '{"version":1,"origin":"elsewhere"}'],
      [
        null,
        '[]',
        '{"version":1,"origin":"manifest","fingerprint":1,"collectionIds":[],"unknownKeys":[]}',
      ],
      [
        null,
        '[]',
        '{"version":1,"origin":"manifest","fingerprint":"f","collectionIds":{},"unknownKeys":[]}',
      ],
      [
        null,
        '[]',
        '{"version":1,"origin":"manifest","fingerprint":"f","collectionIds":[],"unknownKeys":7}',
      ],
    ]) {
      await database.pool.query('DELETE FROM source_sync_state')
      await database.pool.query(
        `INSERT INTO source_sync_state (workspace_id, last_attempt_at, failure, refused, layout)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)`,
        [WORKSPACE, NOW, failure, refusedDocument, layoutDocument],
      )
      expect(await states.find(WORKSPACE)).toMatchObject({
        failure: null,
        refused: [],
        layout: null,
      })
    }
  })

  it('reads a layout leniently, keeping the entries it can', async () => {
    await database.pool.query(
      `INSERT INTO source_sync_state (workspace_id, last_attempt_at, refused, layout)
       VALUES ($1, $2, '[]'::jsonb, $3::jsonb)`,
      [
        WORKSPACE,
        NOW,
        JSON.stringify({
          version: 1,
          origin: 'settings',
          fingerprint: 'f',
          collectionIds: ['a', 7],
          unknownKeys: [{ key: 'x', line: 2 }, { key: 'y' }, 'z'],
        }),
      ],
    )
    expect((await states.find(WORKSPACE))?.layout).toEqual({
      origin: 'settings',
      fingerprint: 'f',
      collectionIds: ['a'],
      unknownKeys: [
        { key: 'x', line: 2 },
        { key: 'y', line: null },
      ],
    })
  })
})
