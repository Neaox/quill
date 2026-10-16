import { beforeEach, describe, expect, it } from 'vitest'
import { userId } from '@quill/domain'

import { createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import {
  addGroupMember,
  createGroup,
  deleteGroup,
  GROUP_AUDIT_EVENTS,
  listGroupMembers,
  listGroups,
  removeGroupMember,
  renameGroup,
  searchPeople,
} from './groups.ts'
import type { GroupsDependencies } from './groups.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const ADMIN = userId('00000000-0000-4000-8000-000000000001')

let uow: InMemoryUnitOfWork
let deps: GroupsDependencies
let audited: { type: string; targetId: string; metadata: unknown }[]

async function unit(name: string, parentId: string | null = null): Promise<string> {
  const id = deps.ids.uuid()
  await uow.repos.units.create({
    id,
    parentId,
    name,
    slug: name.toLowerCase(),
    label: 'unit',
    now: NOW,
  })
  return id
}

async function person(displayName: string, email: string) {
  return uow.repos.users.create({ id: userId(deps.ids.uuid()), email, displayName, now: NOW })
}

async function group(unitId: string, name: string, parentGroupId: string | null = null) {
  const created = await createGroup(deps, { unitId, name, parentGroupId, createdBy: ADMIN })
  if (created.kind !== 'created') throw new Error(`unexpected result: ${created.kind}`)
  audited.length = 0
  return created.group
}

beforeEach(() => {
  uow = createInMemoryUnitOfWork()
  audited = []
  deps = {
    uow: {
      ...uow,
      repos: {
        ...uow.repos,
        audit: {
          async write(input): Promise<void> {
            audited.push(input)
          },
        },
      },
    },
    clock: createFakeClock(NOW),
    ids: createFakeIdGenerator(),
  }
})

describe('createGroup', () => {
  it('creates a group in a unit and audits it', async () => {
    const acme = await unit('Acme')
    const created = await createGroup(deps, {
      unitId: acme,
      name: 'Engineering',
      parentGroupId: null,
      createdBy: ADMIN,
    })
    expect(created.kind === 'created' && created.group).toMatchObject({
      name: 'Engineering',
      unitId: acme,
      parentGroupId: null,
    })
    expect(audited[0]).toMatchObject({ type: GROUP_AUDIT_EVENTS.created })
  })

  it('refuses a unit that is not there', async () => {
    expect(
      await createGroup(deps, { unitId: 'nope', name: 'x', parentGroupId: null, createdBy: ADMIN }),
    ).toEqual({ kind: 'unit-not-found' })
  })

  it('nests under a group of the same unit only', async () => {
    const acme = await unit('Acme')
    const other = await unit('Other')
    const engineering = await group(acme, 'Engineering')

    const nested = await createGroup(deps, {
      unitId: acme,
      name: 'Platform',
      parentGroupId: engineering.id,
      createdBy: ADMIN,
    })
    expect(nested.kind).toBe('created')

    expect(
      await createGroup(deps, {
        unitId: other,
        name: 'Platform',
        parentGroupId: engineering.id,
        createdBy: ADMIN,
      }),
    ).toEqual({ kind: 'parent-in-another-unit' })
    expect(
      await createGroup(deps, {
        unitId: acme,
        name: 'Orphan',
        parentGroupId: 'nope',
        createdBy: ADMIN,
      }),
    ).toEqual({ kind: 'parent-not-found' })
  })

  it('refuses a name already used beside it, ignoring case', async () => {
    const acme = await unit('Acme')
    await group(acme, 'Engineering')
    expect(
      await createGroup(deps, {
        unitId: acme,
        name: ' engineering ',
        parentGroupId: null,
        createdBy: ADMIN,
      }),
    ).toEqual({ kind: 'name-taken' })
  })
})

describe('listGroups', () => {
  it('shows the unit path and member count, ordered by path then name', async () => {
    const acme = await unit('Acme')
    const platform = await unit('Platform', acme)
    const design = await group(acme, 'Design')
    await group(platform, 'Oncall')
    const alice = await person('Alice', 'alice@example.com')
    await addGroupMember(deps, { groupId: design.id, userId: alice.id, addedBy: ADMIN })

    const groups = await listGroups(deps)
    expect(groups.map((entry) => [entry.name, entry.unitPath, entry.memberCount])).toEqual([
      ['Design', 'Acme', 1],
      ['Oncall', 'Acme / Platform', 0],
    ])
  })
})

describe('renameGroup', () => {
  it('renames and audits both names', async () => {
    const acme = await unit('Acme')
    const created = await group(acme, 'Before')
    const renamed = await renameGroup(deps, {
      groupId: created.id,
      name: 'After',
      renamedBy: ADMIN,
    })
    expect(renamed.kind === 'renamed' && renamed.group.name).toBe('After')
    expect(audited[0]).toMatchObject({
      type: GROUP_AUDIT_EVENTS.renamed,
      metadata: { from: 'Before', to: 'After' },
    })
  })

  it('answers not-found, and refuses a name taken beside it', async () => {
    const acme = await unit('Acme')
    await group(acme, 'Taken')
    const other = await group(acme, 'Other')
    expect(await renameGroup(deps, { groupId: 'nope', name: 'x', renamedBy: ADMIN })).toEqual({
      kind: 'not-found',
    })
    expect(await renameGroup(deps, { groupId: other.id, name: 'taken', renamedBy: ADMIN })).toEqual(
      { kind: 'name-taken' },
    )
  })

  it('lets a group keep its own name with different capitalisation', async () => {
    const acme = await unit('Acme')
    const created = await group(acme, 'engineering')
    const renamed = await renameGroup(deps, {
      groupId: created.id,
      name: 'Engineering',
      renamedBy: ADMIN,
    })
    expect(renamed.kind).toBe('renamed')
  })
})

describe('members', () => {
  it('adds idempotently, lists and removes', async () => {
    const acme = await unit('Acme')
    const created = await group(acme, 'Design')
    const alice = await person('Alice', 'alice@example.com')

    const add = () =>
      addGroupMember(deps, { groupId: created.id, userId: alice.id, addedBy: ADMIN })
    expect(await add()).toEqual({ kind: 'added' })
    expect(await add()).toEqual({ kind: 'added' })
    expect(await listGroupMembers(deps, created.id)).toEqual({
      kind: 'members',
      members: [{ id: alice.id, name: 'Alice', email: 'alice@example.com' }],
    })
    expect(audited.map((event) => event.type)).toContain(GROUP_AUDIT_EVENTS.memberAdded)

    expect(
      await removeGroupMember(deps, { groupId: created.id, userId: alice.id, removedBy: ADMIN }),
    ).toEqual({ kind: 'removed' })
    expect(await listGroupMembers(deps, created.id)).toEqual({ kind: 'members', members: [] })
    expect(audited.map((event) => event.type)).toContain(GROUP_AUDIT_EVENTS.memberRemoved)
  })

  it('answers not-found for an unknown group or person', async () => {
    const acme = await unit('Acme')
    const created = await group(acme, 'Design')
    expect(await addGroupMember(deps, { groupId: 'nope', userId: ADMIN, addedBy: ADMIN })).toEqual({
      kind: 'group-not-found',
    })
    expect(
      await addGroupMember(deps, { groupId: created.id, userId: ADMIN, addedBy: ADMIN }),
    ).toEqual({ kind: 'user-not-found' })
    expect(await listGroupMembers(deps, 'nope')).toEqual({ kind: 'not-found' })
    expect(
      await removeGroupMember(deps, { groupId: 'nope', userId: ADMIN, removedBy: ADMIN }),
    ).toEqual({ kind: 'not-found' })
  })

  it('sorts members by name', async () => {
    const acme = await unit('Acme')
    const created = await group(acme, 'Design')
    const zoe = await person('Zoe', 'zoe@example.com')
    const amy = await person('Amy', 'amy@example.com')
    await addGroupMember(deps, { groupId: created.id, userId: zoe.id, addedBy: ADMIN })
    await addGroupMember(deps, { groupId: created.id, userId: amy.id, addedBy: ADMIN })
    const listed = await listGroupMembers(deps, created.id)
    expect(listed.kind === 'members' && listed.members.map((member) => member.name)).toEqual([
      'Amy',
      'Zoe',
    ])
  })
})

describe('deleteGroup', () => {
  it('removes the group, its memberships and every grant that names it', async () => {
    const acme = await unit('Acme')
    const created = await group(acme, 'Design')
    const alice = await person('Alice', 'alice@example.com')
    await addGroupMember(deps, { groupId: created.id, userId: alice.id, addedBy: ADMIN })
    await uow.repos.grants.create({
      id: deps.ids.uuid(),
      principalKind: 'group',
      principalId: created.id,
      scopeKind: 'unit',
      scopeId: acme,
      role: 'editor',
      effect: 'allow',
      createdBy: ADMIN,
      now: NOW,
    })
    audited.length = 0

    expect(await deleteGroup(deps, { groupId: created.id, deletedBy: ADMIN })).toEqual({
      kind: 'deleted',
      members: 1,
      grants: 1,
    })
    expect(await uow.repos.groups.findById(created.id)).toBeNull()
    expect(await uow.repos.grants.listForPrincipal('group', created.id)).toEqual([])
    expect(await uow.repos.groups.listForUser(alice.id)).toEqual([])
    expect(audited[0]).toMatchObject({
      type: GROUP_AUDIT_EVENTS.deleted,
      metadata: { name: 'Design', members: 1, grants: 1 },
    })
  })

  it('refuses while groups nest under it, and answers not-found', async () => {
    const acme = await unit('Acme')
    const parent = await group(acme, 'Engineering')
    await group(acme, 'Platform', parent.id)
    expect(await deleteGroup(deps, { groupId: parent.id, deletedBy: ADMIN })).toEqual({
      kind: 'has-children',
      children: 1,
    })
    expect(await deleteGroup(deps, { groupId: 'nope', deletedBy: ADMIN })).toEqual({
      kind: 'not-found',
    })
  })
})

describe('searchPeople', () => {
  it('matches a name or email prefix, ignoring case, at most 20', async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        person(`Sam ${String(index).padStart(2, '0')}`, `sam${index}@example.com`),
      ),
    )
    await person('Alice', 'alice@example.com')
    await person('Bob', 'sam.b@elsewhere.com')

    expect(await searchPeople(deps, { query: 'SAM' })).toHaveLength(20)
    expect((await searchPeople(deps, { query: 'ali' })).map((entry) => entry.name)).toEqual([
      'Alice',
    ])
    expect((await searchPeople(deps, { query: 'sam.b@' })).map((entry) => entry.name)).toEqual([
      'Bob',
    ])
  })
})
