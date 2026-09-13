import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createUnitRepository } from './unit-repository.ts'

let database: TestDatabase
let units: ReturnType<typeof createUnitRepository>

beforeAll(async () => {
  database = await createTestDatabase()
  units = createUnitRepository(database.db)
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM organisational_units')
})

describe('UnitRepository', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')

  it('creates a root unit and finds it', async () => {
    const root = await units.create({
      id: 'root',
      parentId: null,
      name: 'Acme',
      slug: 'root',
      label: 'unit',
      now,
    })
    expect(root).toEqual({
      id: 'root',
      parentId: null,
      name: 'Acme',
      slug: 'root',
      label: 'unit',
      createdAt: now,
    })
    expect(await units.findById('root')).toEqual(root)
  })

  it('returns null for an unknown unit', async () => {
    expect(await units.findById('nope')).toBeNull()
  })

  it('lists children of a parent, and top-level units for null', async () => {
    await units.create({
      id: 'root',
      parentId: null,
      name: 'Acme',
      slug: 'root',
      label: 'unit',
      now,
    })
    await units.create({
      id: 'eng',
      parentId: 'root',
      name: 'Engineering',
      slug: 'eng',
      label: 'unit',
      now,
    })
    await units.create({
      id: 'sales',
      parentId: 'root',
      name: 'Sales',
      slug: 'sales',
      label: 'unit',
      now,
    })

    const topLevel = await units.listChildren(null)
    expect(topLevel.map((unit) => unit.id)).toEqual(['root'])

    const children = await units.listChildren('root')
    expect(children.map((unit) => unit.id).toSorted()).toEqual(['eng', 'sales'])
  })

  it('renames a unit', async () => {
    await units.create({
      id: 'root',
      parentId: null,
      name: 'Acme',
      slug: 'root',
      label: 'unit',
      now,
    })
    const renamed = await units.rename('root', 'Acme Corp')
    expect(renamed.name).toBe('Acme Corp')
  })

  it('throws when renaming a unit that does not exist', async () => {
    await expect(units.rename('nope', 'x')).rejects.toThrow('rename: unit not found')
  })

  it('deletes a unit', async () => {
    await units.create({
      id: 'root',
      parentId: null,
      name: 'Acme',
      slug: 'root',
      label: 'unit',
      now,
    })
    await units.delete('root')
    expect(await units.findById('root')).toBeNull()
  })
})
