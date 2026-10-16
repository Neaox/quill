import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * Groups and people, administered by an instance admin (ADR-052): who may,
 * what each answer looks like, and what deleting a group takes with it.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let admin: Record<string, string>
let editor: Record<string, string>

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  admin = await harness.cookiesFor(tenancy.admin)
  editor = await harness.cookiesFor(tenancy.editor)
}, 30_000)

afterAll(async () => {
  await harness.close()
})

const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  cookies: Record<string, string> | undefined,
  payload?: Record<string, unknown>,
) =>
  harness.app.inject({
    method,
    url,
    ...(cookies ? { cookies } : {}),
    ...(payload ? { payload } : {}),
  })

async function createGroup(name: string, parentGroupId?: string): Promise<string> {
  const response = await call('POST', '/api/groups', admin, {
    unitId: tenancy.unitId,
    name,
    ...(parentGroupId === undefined ? {} : { parentGroupId }),
  })
  expect(response.statusCode).toBe(201)
  return response.json().id
}

async function auditTypes(): Promise<string[]> {
  const result = await harness.database.pool.query<{ type: string }>(
    `SELECT type FROM audit_events WHERE target_type = 'group' ORDER BY created_at, id`,
  )
  return result.rows.map((row) => row.type)
}

describe('who may administer groups', () => {
  it('needs a session', async () => {
    expect((await call('GET', '/api/groups', undefined)).statusCode).toBe(401)
  })

  it('refuses everybody who is not an instance admin, on every route', async () => {
    const id = await createGroup('Guarded')
    const attempts = [
      call('GET', '/api/groups', editor),
      call('POST', '/api/groups', editor, { unitId: tenancy.unitId, name: 'x' }),
      call('PATCH', `/api/groups/${id}`, editor, { name: 'x' }),
      call('DELETE', `/api/groups/${id}`, editor),
      call('GET', `/api/groups/${id}/members`, editor),
      call('PUT', `/api/groups/${id}/members/${tenancy.viewer}`, editor),
      call('DELETE', `/api/groups/${id}/members/${tenancy.viewer}`, editor),
      call('GET', '/api/people?q=a', editor),
    ]
    for (const response of await Promise.all(attempts)) expect(response.statusCode).toBe(403)
  })
})

describe('groups', () => {
  it('lists every group with its unit path and member count', async () => {
    const id = await createGroup('Listed')
    await call('PUT', `/api/groups/${id}/members/${tenancy.viewer}`, admin)

    const listed = (await call('GET', '/api/groups', admin)).json()
    expect(listed.groups).toContainEqual({
      id,
      name: 'Listed',
      unitId: tenancy.unitId,
      unitPath: 'Acme',
      parentGroupId: null,
      memberCount: 1,
    })
  })

  it('refuses a field it does not know, rather than quietly dropping it', async () => {
    const response = await call('POST', '/api/groups', admin, {
      unitId: tenancy.unitId,
      name: 'Strict',
      grantAdmin: true,
    })
    expect(response.statusCode).toBe(400)
  })

  it('creates nested groups and refuses bad parents, units and duplicate names', async () => {
    const parent = await createGroup('Parent')
    const nested = await call('POST', '/api/groups', admin, {
      unitId: tenancy.unitId,
      name: 'Child',
      parentGroupId: parent,
    })
    expect(nested.statusCode).toBe(201)
    expect(nested.json().parentGroupId).toBe(parent)

    const missingParent = await call('POST', '/api/groups', admin, {
      unitId: tenancy.unitId,
      name: 'Orphan',
      parentGroupId: 'nope',
    })
    expect(missingParent.statusCode).toBe(404)
    const missingUnit = await call('POST', '/api/groups', admin, { unitId: 'nope', name: 'Lost' })
    expect(missingUnit.statusCode).toBe(404)
    const duplicate = await call('POST', '/api/groups', admin, {
      unitId: tenancy.unitId,
      name: 'parent',
    })
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json().error.code).toBe('group_name_taken')
    const blank = await call('POST', '/api/groups', admin, { unitId: tenancy.unitId, name: '  ' })
    expect(blank.statusCode).toBe(400)
  })

  it('renames, and answers 404 for a group that is not there', async () => {
    const id = await createGroup('Before')
    const renamed = await call('PATCH', `/api/groups/${id}`, admin, { name: 'After' })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json()).toMatchObject({ id, name: 'After' })
    expect((await call('PATCH', '/api/groups/nope', admin, { name: 'x' })).statusCode).toBe(404)
  })

  it('refuses to delete a group that others nest under', async () => {
    const parent = await createGroup('Has children')
    await createGroup('Nested', parent)
    const refused = await call('DELETE', `/api/groups/${parent}`, admin)
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error).toMatchObject({ code: 'group_has_children' })
  })

  it('deletes a group with its memberships and the grants that name it, and audits it', async () => {
    const id = await createGroup('Doomed')
    await call('PUT', `/api/groups/${id}/members/${tenancy.viewer}`, admin)
    await harness.deps.uow.repos.grants.create({
      id: harness.deps.ids.uuid(),
      principalKind: 'group',
      principalId: id,
      scopeKind: 'workspace',
      scopeId: tenancy.workspaceId,
      role: 'editor',
      effect: 'allow',
      createdBy: tenancy.admin,
      now: harness.clock.now(),
    })

    const deleted = await call('DELETE', `/api/groups/${id}`, admin)
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toEqual({ members: 1, grants: 1 })
    expect(await harness.deps.uow.repos.groups.findById(id)).toBeNull()
    expect(await harness.deps.uow.repos.grants.listForPrincipal('group', id)).toEqual([])
    expect(await harness.deps.uow.repos.groups.listForUser(tenancy.viewer)).not.toContainEqual(
      expect.objectContaining({ id }),
    )
    expect(await auditTypes()).toContain('group.deleted')
    expect((await call('DELETE', `/api/groups/${id}`, admin)).statusCode).toBe(404)
  })
})

describe('members', () => {
  it('adds, lists, and removes, and adding twice is harmless', async () => {
    const id = await createGroup('Team')
    expect(
      (await call('PUT', `/api/groups/${id}/members/${tenancy.viewer}`, admin)).statusCode,
    ).toBe(204)
    expect(
      (await call('PUT', `/api/groups/${id}/members/${tenancy.viewer}`, admin)).statusCode,
    ).toBe(204)

    const listed = await call('GET', `/api/groups/${id}/members`, admin)
    expect(listed.json()).toEqual({
      members: [{ id: tenancy.viewer, name: 'Viewer', email: 'viewer@example.com' }],
    })

    expect(
      (await call('DELETE', `/api/groups/${id}/members/${tenancy.viewer}`, admin)).statusCode,
    ).toBe(204)
    expect((await call('GET', `/api/groups/${id}/members`, admin)).json()).toEqual({ members: [] })
    expect(await auditTypes()).toEqual(
      expect.arrayContaining(['group.created', 'group.member_added', 'group.member_removed']),
    )
  })

  it('answers 404 for an unknown group or person', async () => {
    const id = await createGroup('Known')
    expect(
      (await call('PUT', `/api/groups/nope/members/${tenancy.viewer}`, admin)).statusCode,
    ).toBe(404)
    const stranger = '00000000-0000-4000-8000-00000000ffff'
    expect((await call('PUT', `/api/groups/${id}/members/${stranger}`, admin)).statusCode).toBe(404)
    expect((await call('PUT', `/api/groups/${id}/members/nobody`, admin)).statusCode).toBe(400)
    expect((await call('GET', '/api/groups/nope/members', admin)).statusCode).toBe(404)
    expect(
      (await call('DELETE', `/api/groups/nope/members/${tenancy.viewer}`, admin)).statusCode,
    ).toBe(404)
  })
})

describe('GET /api/units?all=true', () => {
  it('lists every unit at every depth in one answer, for the new-group picker', async () => {
    const nested = await harness.deps.uow.repos.units.create({
      id: harness.deps.ids.uuid(),
      parentId: tenancy.unitId,
      name: 'Platform',
      slug: 'platform',
      label: 'team',
      now: harness.clock.now(),
    })
    const all = (await call('GET', '/api/units?all=true', admin)).json()
    expect(all.map((unit: { id: string }) => unit.id)).toEqual(
      expect.arrayContaining([tenancy.unitId, nested.id]),
    )
    const roots = (await call('GET', '/api/units', admin)).json()
    expect(roots.map((unit: { id: string }) => unit.id)).not.toContain(nested.id)
  })
})

describe('GET /api/people', () => {
  it('finds people by name or email prefix, ignoring case', async () => {
    const byName = (await call('GET', '/api/people?q=VIE', admin)).json()
    expect(byName).toEqual({
      people: [{ id: tenancy.viewer, name: 'Viewer', email: 'viewer@example.com' }],
    })
    const byEmail = (await call('GET', '/api/people?q=edit', admin)).json()
    expect(byEmail.people.map((person: { name: string }) => person.name)).toEqual(['Editor'])
  })

  it('treats wildcard characters literally and returns nothing for a miss', async () => {
    expect((await call('GET', '/api/people?q=%25', admin)).json()).toEqual({ people: [] })
    expect((await call('GET', '/api/people?q=_', admin)).json()).toEqual({ people: [] })
  })

  it('lists the first people alphabetically with no query, at most 20', async () => {
    const response = (await call('GET', '/api/people', admin)).json()
    expect(response.people.length).toBeLessThanOrEqual(20)
    expect(response.people.length).toBeGreaterThan(0)
  })
})
