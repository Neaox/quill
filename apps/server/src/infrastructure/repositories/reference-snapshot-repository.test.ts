import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { workspaceId } from '@quill/domain'

import type { ReferenceSnapshotRow } from '@quill/application'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createReferenceSnapshotRepository } from './reference-snapshot-repository.ts'
import { createUnitRepository } from './unit-repository.ts'
import { createWorkspaceRepository } from './workspace-repository.ts'

let database: TestDatabase
let snapshots: ReturnType<typeof createReferenceSnapshotRepository>
let workspaces: ReturnType<typeof createWorkspaceRepository>

const NOW = new Date('2026-11-14T10:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const OTHER = workspaceId('00000000-0000-4000-8000-000000000102')

beforeAll(async () => {
  database = await createTestDatabase()
  snapshots = createReferenceSnapshotRepository(database.db)
  workspaces = createWorkspaceRepository(database.db)
  await createUnitRepository(database.db).create({
    id: 'unit-1',
    parentId: null,
    name: 'Unit',
    slug: 'unit',
    label: 'unit',
    now: NOW,
  })
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM reference_snapshots')
  await database.pool.query('DELETE FROM workspaces')
  for (const [id, slug] of [
    [WORKSPACE, 'engineering'],
    [OTHER, 'product'],
  ] as const) {
    await workspaces.create({ id, unitId: 'unit-1', name: slug, slug, now: NOW })
  }
})

function snapshot(overrides: Partial<ReferenceSnapshotRow> = {}): ReferenceSnapshotRow {
  return {
    id: 'snapshot-1',
    workspaceId: WORKSPACE,
    kind: 'code',
    sourceCommit: 'abc1234',
    capturedAt: new Date('2026-11-14T09:00:00.000Z'),
    artifactHash: 'a'.repeat(64),
    artifactSize: 1024,
    artifactVersion: 1,
    symbolCount: 18_409,
    tableCount: 0,
    createdAt: NOW,
    ...overrides,
  }
}

describe('ReferenceSnapshotRepository', () => {
  it('inserts a snapshot and finds it by id', async () => {
    const row = snapshot()
    await snapshots.insert(row)

    expect(await snapshots.findById(row.id)).toEqual(row)
    expect(await snapshots.findById('missing')).toBeNull()
  })

  it('answers the latest of one kind by capture time', async () => {
    await snapshots.insert(
      snapshot({ id: 'older', capturedAt: new Date('2026-11-14T08:00:00.000Z') }),
    )
    await snapshots.insert(
      snapshot({ id: 'newer', capturedAt: new Date('2026-11-14T09:00:00.000Z') }),
    )
    await snapshots.insert(
      snapshot({ id: 'schema', kind: 'schema', capturedAt: new Date('2026-11-14T09:30:00.000Z') }),
    )

    expect((await snapshots.latest(WORKSPACE, 'code'))?.id).toBe('newer')
    expect((await snapshots.latest(WORKSPACE, 'schema'))?.id).toBe('schema')
    expect(await snapshots.latest(OTHER, 'code')).toBeNull()
  })

  it('lists newest first and stops at the limit', async () => {
    for (const [id, hour] of [
      ['one', 7],
      ['two', 8],
      ['three', 9],
    ] as const) {
      await snapshots.insert(
        snapshot({ id, capturedAt: new Date(`2026-11-14T0${String(hour)}:00:00.000Z`) }),
      )
    }

    expect((await snapshots.list(WORKSPACE, 'code', 10)).map((row) => row.id)).toEqual([
      'three',
      'two',
      'one',
    ])
    expect((await snapshots.list(WORKSPACE, 'code', 2)).map((row) => row.id)).toEqual([
      'three',
      'two',
    ])
  })

  it('takes every snapshot with the workspace', async () => {
    await snapshots.insert(snapshot())

    await workspaces.delete(WORKSPACE)

    expect(await snapshots.findById('snapshot-1')).toBeNull()
  })

  it('refuses a second snapshot of the same commit at the same instant', async () => {
    await snapshots.insert(snapshot())

    await expect(snapshots.insert(snapshot({ id: 'snapshot-2' }))).rejects.toMatchObject({
      // Postgres's unique-violation code, through the driver's wrapper.
      cause: expect.objectContaining({ code: '23505' }),
    })
  })
})
