import { beforeEach, describe, expect, it } from 'vitest'
import { groupPrincipal, PUBLIC_PRINCIPAL, userId, userPrincipal, workspaceId } from '@quill/domain'
import type { GroupId, Principal } from '@quill/domain'

import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { listVisibleWorkspaces } from './list-visible-workspaces.ts'

/**
 * The workspace picker has to agree with the authorizer: a workspace a
 * direct read refuses must not appear in the list, and a grant anywhere on
 * the unit chain above a workspace has to reach it.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const ENGINEERING = workspaceId('00000000-0000-4000-8000-000000000101')
const FINANCE = workspaceId('00000000-0000-4000-8000-000000000102')
const HANDBOOK = workspaceId('00000000-0000-4000-8000-000000000103')
const READER = userId('00000000-0000-4000-8000-000000000001')
const PLATFORM = '00000000-0000-4000-8000-000000000501' as GroupId

const identities: readonly Principal[] = [
  userPrincipal(READER),
  groupPrincipal(PLATFORM),
  PUBLIC_PRINCIPAL,
]

let uow: InMemoryUnitOfWork
let nextGrant = 0

async function grant(
  fields: Omit<Parameters<InMemoryUnitOfWork['repos']['grants']['create']>[0], 'id' | 'now'>,
): Promise<void> {
  nextGrant += 1
  await uow.repos.grants.create({ ...fields, id: `grant-${nextGrant}`, now: NOW })
}

async function visibleNames(seesEverything = false): Promise<readonly string[]> {
  const result = await listVisibleWorkspaces({ uow }, { identities, seesEverything })
  return result.workspaces.map((visible) => visible.workspace.name)
}

beforeEach(async () => {
  nextGrant = 0
  uow = createInMemoryUnitOfWork()
  for (const [id, parentId, name] of [
    ['acme', null, 'Acme'],
    ['engineering-unit', 'acme', 'Engineering'],
    ['finance-unit', 'acme', 'Finance'],
  ] as const) {
    await uow.repos.units.create({ id, parentId, name, slug: id, label: 'unit', now: NOW })
  }
  for (const [id, unitId, name, slug] of [
    [ENGINEERING, 'engineering-unit', 'Platform docs', 'platform-docs'],
    [FINANCE, 'finance-unit', 'Ledger', 'ledger'],
    [HANDBOOK, 'acme', 'Handbook', 'handbook'],
  ] as const) {
    await uow.repos.workspaces.create({ id, unitId, name, slug, now: NOW })
  }
})

describe('listVisibleWorkspaces', () => {
  it('shows nothing to a request that holds no grant', async () => {
    expect(await visibleNames()).toEqual([])
  })

  it('shows every workspace to an instance admin, without reading a grant', async () => {
    expect(await visibleNames(true)).toEqual(['Handbook', 'Platform docs', 'Ledger'])
  })

  it('shows only the workspace a user grant names', async () => {
    await grant({
      principalKind: 'user',
      principalId: READER,
      scopeKind: 'workspace',
      scopeId: ENGINEERING,
      role: 'editor',
      effect: 'allow',
      createdBy: null,
    })
    expect(await visibleNames()).toEqual(['Platform docs'])
  })

  it('lets a grant on a unit above the workspace reach it', async () => {
    await grant({
      principalKind: 'group',
      principalId: PLATFORM,
      scopeKind: 'unit',
      scopeId: 'acme',
      role: 'viewer',
      effect: 'allow',
      createdBy: null,
    })
    expect(await visibleNames()).toEqual(['Handbook', 'Platform docs', 'Ledger'])
  })

  it('lets an instance-scoped grant reach every workspace', async () => {
    await grant({
      principalKind: 'public',
      principalId: null,
      scopeKind: 'instance',
      scopeId: null,
      role: 'viewer',
      effect: 'allow',
      createdBy: null,
    })
    expect(await visibleNames()).toEqual(['Handbook', 'Platform docs', 'Ledger'])
  })

  it('sorts by unit path and then by name', async () => {
    await grant({
      principalKind: 'user',
      principalId: READER,
      scopeKind: 'unit',
      scopeId: 'acme',
      role: 'viewer',
      effect: 'allow',
      createdBy: null,
    })
    const result = await listVisibleWorkspaces({ uow }, { identities, seesEverything: false })
    expect(
      result.workspaces.map((visible) => [visible.unitPath.join(' / '), visible.workspace.name]),
    ).toEqual([
      ['Acme', 'Handbook'],
      ['Acme / Engineering', 'Platform docs'],
      ['Acme / Finance', 'Ledger'],
    ])
  })

  it('orders two workspaces in the same unit by name, whichever order they were created in', async () => {
    await uow.repos.workspaces.create({
      id: workspaceId('00000000-0000-4000-8000-000000000106'),
      unitId: 'acme',
      name: 'Almanac',
      slug: 'almanac',
      now: NOW,
    })
    // A third, later in the alphabet, so the name comparison is exercised in
    // both directions rather than only "before Handbook".
    await uow.repos.workspaces.create({
      id: workspaceId('00000000-0000-4000-8000-000000000107'),
      unitId: 'acme',
      name: 'Zoning',
      slug: 'zoning',
      now: NOW,
    })
    expect((await visibleNames(true)).slice(0, 3)).toEqual(['Almanac', 'Handbook', 'Zoning'])
  })

  it('names the owning unit beside each workspace', async () => {
    const result = await listVisibleWorkspaces({ uow }, { identities, seesEverything: true })
    expect(result.workspaces.map((visible) => visible.unit.name)).toEqual([
      'Acme',
      'Engineering',
      'Finance',
    ])
  })

  it('breaks a tie on name by id, so the order is total', async () => {
    // Two more with the same name, created out of id order, so the comparison
    // is exercised in both directions.
    await uow.repos.workspaces.create({
      id: workspaceId('00000000-0000-4000-8000-000000000105'),
      unitId: 'acme',
      name: 'Handbook',
      slug: 'handbook-three',
      now: NOW,
    })
    await uow.repos.workspaces.create({
      id: workspaceId('00000000-0000-4000-8000-000000000104'),
      unitId: 'acme',
      name: 'Handbook',
      slug: 'handbook-two',
      now: NOW,
    })
    const result = await listVisibleWorkspaces({ uow }, { identities, seesEverything: true })
    expect(result.workspaces.map((visible) => visible.workspace.slug)).toEqual([
      'handbook',
      'handbook-two',
      'handbook-three',
      'platform-docs',
      'ledger',
    ])
  })

  it('answers an empty list when the instance has no workspace at all', async () => {
    const empty = createInMemoryUnitOfWork()
    const result = await listVisibleWorkspaces({ uow: empty }, { identities, seesEverything: true })
    expect(result.workspaces).toEqual([])
  })

  it('omits a workspace whose owning unit no longer exists rather than failing the list', async () => {
    await uow.repos.units.delete('finance-unit')
    expect(await visibleNames(true)).toEqual(['Handbook', 'Platform docs'])
  })
})
