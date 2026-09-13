import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { workspaceId } from '@quill/domain'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createUnitRepository } from './unit-repository.ts'
import { createWorkspaceRepository } from './workspace-repository.ts'
import { createWorkspaceSlugHistoryRepository } from './workspace-slug-history-repository.ts'

let database: TestDatabase
let workspaces: ReturnType<typeof createWorkspaceRepository>
let slugHistory: ReturnType<typeof createWorkspaceSlugHistoryRepository>

beforeAll(async () => {
  database = await createTestDatabase()
  workspaces = createWorkspaceRepository(database.db)
  slugHistory = createWorkspaceSlugHistoryRepository(database.db)
  await createUnitRepository(database.db).create({
    id: 'unit-1',
    parentId: null,
    name: 'Unit',
    slug: 'unit',
    label: 'unit',
    now: new Date('2026-01-01T00:00:00.000Z'),
  })
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM workspaces')
})

describe('WorkspaceRepository', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')
  const ENGINEERING = workspaceId('00000000-0000-4000-8000-000000000001')

  it('creates a workspace and finds it by id and slug', async () => {
    const created = await workspaces.create({
      id: ENGINEERING,
      unitId: 'unit-1',
      name: 'Engineering',
      slug: 'engineering',
      now,
    })
    expect(created).toEqual({
      id: ENGINEERING,
      unitId: 'unit-1',
      name: 'Engineering',
      slug: 'engineering',
      createdAt: now,
    })
    expect(await workspaces.findById(ENGINEERING)).toEqual(created)
    expect(await workspaces.findBySlug('engineering')).toEqual(created)
  })

  it('returns null for an unknown id or slug', async () => {
    expect(
      await workspaces.findById(workspaceId('00000000-0000-4000-8000-000000000099')),
    ).toBeNull()
    expect(await workspaces.findBySlug('nope')).toBeNull()
  })

  it('lists workspaces by unit', async () => {
    await workspaces.create({
      id: ENGINEERING,
      unitId: 'unit-1',
      name: 'Engineering',
      slug: 'engineering',
      now,
    })
    const list = await workspaces.listByUnit('unit-1')
    expect(list.map((w) => w.slug)).toEqual(['engineering'])
  })

  it('renames a workspace, leaving the slug alone unless one is given', async () => {
    await workspaces.create({
      id: ENGINEERING,
      unitId: 'unit-1',
      name: 'Engineering',
      slug: 'engineering',
      now,
    })
    const renamed = await workspaces.rename(ENGINEERING, 'Eng')
    expect(renamed).toMatchObject({ name: 'Eng', slug: 'engineering' })

    const moved = await workspaces.rename(ENGINEERING, 'Eng', 'eng')
    expect(moved).toMatchObject({ name: 'Eng', slug: 'eng' })
  })

  it('throws when renaming a workspace that does not exist', async () => {
    await expect(
      workspaces.rename(workspaceId('00000000-0000-4000-8000-000000000099'), 'x'),
    ).rejects.toThrow('rename: workspace not found')
  })

  it('deletes a workspace', async () => {
    await workspaces.create({
      id: ENGINEERING,
      unitId: 'unit-1',
      name: 'Engineering',
      slug: 'engineering',
      now,
    })
    await workspaces.delete(ENGINEERING)
    expect(await workspaces.findById(ENGINEERING)).toBeNull()
  })
})

describe('WorkspaceSlugHistoryRepository', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')
  const ENGINEERING = workspaceId('00000000-0000-4000-8000-000000000001')
  const PLATFORM = workspaceId('00000000-0000-4000-8000-000000000002')
  const YEAR_MS = 365 * 24 * 60 * 60 * 1000

  beforeEach(async () => {
    for (const [id, slug] of [
      [ENGINEERING, 'engineering'],
      [PLATFORM, 'platform'],
    ] as const) {
      await workspaces.create({ id, unitId: 'unit-1', name: slug, slug, now })
    }
  })

  it('records a retired slug and answers with it until its cutoff', async () => {
    await slugHistory.record({ workspaceId: ENGINEERING, slug: 'eng', now })

    expect(await slugHistory.findBySlug('eng', now)).toEqual({
      workspaceId: ENGINEERING,
      slug: 'eng',
      retiredAt: now,
    })
    expect(await slugHistory.findBySlug('eng', new Date(now.getTime() + YEAR_MS))).toBeNull()
    expect(await slugHistory.findBySlug('never-used', now)).toBeNull()
  })

  it('lets the newest claim on a slug replace the one before it', async () => {
    const later = new Date(now.getTime() + 1000)
    await slugHistory.record({ workspaceId: ENGINEERING, slug: 'eng', now })
    await slugHistory.record({ workspaceId: PLATFORM, slug: 'eng', now: later })

    expect(await slugHistory.findBySlug('eng', now)).toEqual({
      workspaceId: PLATFORM,
      slug: 'eng',
      retiredAt: later,
    })
  })

  it(`forgets a workspace's history with the workspace`, async () => {
    await slugHistory.record({ workspaceId: ENGINEERING, slug: 'eng', now })
    await workspaces.delete(ENGINEERING)
    expect(await slugHistory.findBySlug('eng', now)).toBeNull()
  })
})
