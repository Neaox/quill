import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, userId, workspaceId } from '@quill/domain'

import { aShortId, createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import {
  createUnit,
  createWorkspace,
  deleteUnit,
  deleteWorkspace,
  renameUnit,
  renameWorkspace,
  TENANCY_AUDIT_EVENTS,
} from './tenancy.ts'

/**
 * Review finding L6: these were repository calls straight from the route
 * layer, so reshaping the organisation — the most consequential thing an
 * instance administrator can do — wrote no audit row at all.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const ACTOR = userId('00000000-0000-4000-8000-000000000001')

let uow: InMemoryUnitOfWork
let deps: {
  uow: InMemoryUnitOfWork
  clock: ReturnType<typeof createFakeClock>
  ids: ReturnType<typeof createFakeIdGenerator>
}
let audited: { type: string; targetId: string; metadata: unknown }[]

async function unit(name = 'Acme', parentId: string | null = null): Promise<string> {
  const created = await createUnit(deps, { parentId, name, createdBy: ACTOR })
  if (created.kind !== 'created') throw new Error(`unexpected result: ${created.kind}`)
  audited.length = 0
  return created.unit.id
}

beforeEach(() => {
  uow = createInMemoryUnitOfWork()
  audited = []
  const withAudit: InMemoryUnitOfWork = {
    ...uow,
    repos: {
      ...uow.repos,
      audit: {
        async write(input): Promise<void> {
          audited.push(input)
        },
      },
    },
  }
  deps = { uow: withAudit, clock: createFakeClock(NOW), ids: createFakeIdGenerator() }
})

describe('createUnit', () => {
  it('derives a slug and a neutral label, and audits it', async () => {
    const created = await createUnit(deps, {
      parentId: null,
      name: 'Acme Corporation',
      createdBy: ACTOR,
    })
    if (created.kind !== 'created') throw new Error(`unexpected result: ${created.kind}`)

    expect(created.unit).toMatchObject({ slug: 'acme-corporation', label: 'unit', parentId: null })
    expect(audited[0]).toMatchObject({
      type: TENANCY_AUDIT_EVENTS.unitCreated,
      targetType: 'unit',
      targetId: created.unit.id,
    })
  })

  it('takes an explicit slug and label', async () => {
    const created = await createUnit(deps, {
      parentId: null,
      name: 'Acme',
      slug: 'acme-inc',
      label: 'company',
      createdBy: ACTOR,
    })
    expect(created.kind === 'created' && created.unit).toMatchObject({
      slug: 'acme-inc',
      label: 'company',
    })
  })

  it('nests under an existing parent, and refuses one that is not there', async () => {
    const parent = await unit()
    expect(
      (await createUnit(deps, { parentId: parent, name: 'Platform', createdBy: ACTOR })).kind,
    ).toBe('created')
    // A parent that does not exist would put the unit outside every chain,
    // which makes everything under it unresolvable (ADR-012).
    expect(await createUnit(deps, { parentId: 'nope', name: 'Orphan', createdBy: ACTOR })).toEqual({
      kind: 'parent-not-found',
    })
  })
})

describe('renameUnit', () => {
  it('renames and audits both names', async () => {
    const id = await unit('Before')
    const renamed = await renameUnit(deps, { unitId: id, name: 'After', renamedBy: ACTOR })
    expect(renamed.kind === 'renamed' && renamed.unit.name).toBe('After')
    expect(audited[0]).toMatchObject({
      type: TENANCY_AUDIT_EVENTS.unitRenamed,
      metadata: { from: 'Before', to: 'After' },
    })
  })

  it('answers not-found for a unit that does not exist', async () => {
    expect(await renameUnit(deps, { unitId: 'nope', name: 'x', renamedBy: ACTOR })).toEqual({
      kind: 'not-found',
    })
  })
})

describe('deleteUnit', () => {
  it('deletes an empty unit', async () => {
    const id = await unit()
    expect(await deleteUnit(deps, { unitId: id, deletedBy: ACTOR })).toEqual({ kind: 'deleted' })
    expect(await uow.repos.units.findById(id)).toBeNull()
    expect(audited[0]).toMatchObject({ type: TENANCY_AUDIT_EVENTS.unitDeleted })
  })

  it('answers not-found for a unit that does not exist', async () => {
    expect(await deleteUnit(deps, { unitId: 'nope', deletedBy: ACTOR })).toEqual({
      kind: 'not-found',
    })
  })

  /** The row cascades, so deleting a populated unit takes a tree with it. */
  it('refuses while it still holds a workspace or a child unit', async () => {
    const withWorkspace = await unit('Has a workspace')
    await createWorkspace(deps, {
      unitId: withWorkspace,
      name: 'Engineering',
      slug: 'engineering',
      createdBy: ACTOR,
    })
    expect(await deleteUnit(deps, { unitId: withWorkspace, deletedBy: ACTOR })).toEqual({
      kind: 'not-empty',
      workspaces: 1,
      units: 0,
    })

    const withChild = await unit('Has a child')
    await createUnit(deps, { parentId: withChild, name: 'Platform', createdBy: ACTOR })
    expect(await deleteUnit(deps, { unitId: withChild, deletedBy: ACTOR })).toEqual({
      kind: 'not-empty',
      workspaces: 0,
      units: 1,
    })
  })
})

describe('createWorkspace', () => {
  it('creates it under an existing unit and audits it', async () => {
    const owner = await unit()
    const created = await createWorkspace(deps, {
      unitId: owner,
      name: 'Engineering',
      slug: 'engineering',
      createdBy: ACTOR,
    })
    if (created.kind !== 'created') throw new Error(`unexpected result: ${created.kind}`)
    expect(created.workspace).toMatchObject({ unitId: owner, slug: 'engineering' })
    expect(audited[0]).toMatchObject({
      type: TENANCY_AUDIT_EVENTS.workspaceCreated,
      targetType: 'workspace',
    })
  })

  it('refuses a unit that does not exist', async () => {
    expect(
      await createWorkspace(deps, {
        unitId: 'nope',
        name: 'Engineering',
        slug: 'engineering',
        createdBy: ACTOR,
      }),
    ).toEqual({ kind: 'unit-not-found' })
  })

  /** The slug is what a published site is addressed by, so it is instance-wide. */
  it('refuses a slug another workspace already uses, in any unit', async () => {
    const first = await unit('First')
    const second = await unit('Second')
    await createWorkspace(deps, {
      unitId: first,
      name: 'Engineering',
      slug: 'engineering',
      createdBy: ACTOR,
    })
    expect(
      await createWorkspace(deps, {
        unitId: second,
        name: 'Engineering again',
        slug: 'engineering',
        createdBy: ACTOR,
      }),
    ).toEqual({ kind: 'slug-taken', slug: 'engineering' })
  })
})

describe('renameWorkspace and deleteWorkspace', () => {
  async function workspace(): Promise<string> {
    const owner = await unit()
    const created = await createWorkspace(deps, {
      unitId: owner,
      name: 'Engineering',
      slug: 'engineering',
      createdBy: ACTOR,
    })
    if (created.kind !== 'created') throw new Error('expected a workspace')
    audited.length = 0
    return created.workspace.id
  }

  it('renames without moving the slug', async () => {
    const id = await workspace()
    const renamed = await renameWorkspace(deps, {
      workspaceId: workspaceId(id),
      name: 'Platform',
      renamedBy: ACTOR,
    })
    // Nobody's URLs move because somebody retitled a workspace.
    expect(renamed.kind === 'renamed' && renamed.workspace).toMatchObject({
      name: 'Platform',
      slug: 'engineering',
    })
    expect(audited[0]).toMatchObject({ type: TENANCY_AUDIT_EVENTS.workspaceRenamed })
  })

  it('moves the slug when asked, and keeps the old one as a forwarding address', async () => {
    const id = await workspace()
    const renamed = await renameWorkspace(deps, {
      workspaceId: workspaceId(id),
      name: 'Platform',
      slug: 'platform',
      renamedBy: ACTOR,
    })
    expect(renamed.kind === 'renamed' && renamed.workspace).toMatchObject({
      name: 'Platform',
      slug: 'platform',
    })
    expect(await uow.repos.workspaceSlugHistory.findBySlug('engineering', NOW)).toMatchObject({
      workspaceId: id,
      slug: 'engineering',
    })
    expect(audited[0]).toMatchObject({
      type: TENANCY_AUDIT_EVENTS.workspaceRenamed,
      metadata: { slug: 'platform', retiredSlug: 'engineering' },
    })
  })

  it('records nothing when the slug given is the one it already has', async () => {
    const id = await workspace()
    await renameWorkspace(deps, {
      workspaceId: workspaceId(id),
      name: 'Platform',
      slug: 'engineering',
      renamedBy: ACTOR,
    })
    expect(await uow.repos.workspaceSlugHistory.findBySlug('engineering', NOW)).toBeNull()
  })

  it('refuses to move onto a slug another workspace holds', async () => {
    const id = await workspace()
    const owner = await unit()
    await createWorkspace(deps, {
      unitId: owner,
      name: 'Platform',
      slug: 'platform',
      createdBy: ACTOR,
    })
    expect(
      await renameWorkspace(deps, {
        workspaceId: workspaceId(id),
        name: 'Engineering',
        slug: 'platform',
        renamedBy: ACTOR,
      }),
    ).toEqual({ kind: 'slug-taken', slug: 'platform' })
  })

  it('records how much went with a deleted workspace', async () => {
    const id = await workspace()
    await uow.repos.documents.create({
      id: documentId('00000000-0000-4000-8000-000000000201'),
      shortId: aShortId(),
      workspaceId: workspaceId(id),
      collectionId: null,
      parentId: null,
      slug: 'a-note',
      path: 'a-note.md',
      title: 'A note',
      status: 'draft',
      templateId: null,
      templateVersion: null,
      now: NOW,
    })

    expect(await deleteWorkspace(deps, { workspaceId: workspaceId(id), deletedBy: ACTOR })).toEqual(
      { kind: 'deleted', documents: 1 },
    )
    // "Somebody deleted Engineering" is a question the log answers with a number.
    expect(audited[0]).toMatchObject({
      type: TENANCY_AUDIT_EVENTS.workspaceDeleted,
      metadata: { name: 'Engineering', slug: 'engineering', documents: 1 },
    })
  })

  it('answers not-found for a workspace that does not exist', async () => {
    const missing = workspaceId('00000000-0000-4000-8000-0000000001ff')
    expect(
      await renameWorkspace(deps, { workspaceId: missing, name: 'x', renamedBy: ACTOR }),
    ).toEqual({ kind: 'not-found' })
    expect(await deleteWorkspace(deps, { workspaceId: missing, deletedBy: ACTOR })).toEqual({
      kind: 'not-found',
    })
  })
})
