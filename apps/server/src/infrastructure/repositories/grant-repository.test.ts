import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userId } from '@quill/domain'

import { createUuidGenerator } from '../uuid-generator.ts'
import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createGrantRepository } from './grant-repository.ts'
import { createUserRepository } from './user-repository.ts'

let database: TestDatabase
let grants: ReturnType<typeof createGrantRepository>
const ALICE = userId('00000000-0000-4000-8000-000000000001')
const BOB = userId('00000000-0000-4000-8000-000000000002')

beforeAll(async () => {
  database = await createTestDatabase()
  grants = createGrantRepository(database.db, createUuidGenerator())
  const now = new Date('2026-01-01T00:00:00.000Z')
  const users = createUserRepository(database.db)
  await users.create({ id: ALICE, email: 'ada@example.com', displayName: 'Ada', now })
  await users.create({ id: BOB, email: 'bob@example.com', displayName: 'Bob', now })
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM grants')
  await database.pool.query("DELETE FROM principals WHERE kind != 'public'")
})

describe('GrantRepository', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')

  it('creates a grant for a user principal and lists it by scope and by principal', async () => {
    const grant = await grants.create({
      id: 'grant-1',
      principalKind: 'user',
      principalId: ALICE,
      scopeKind: 'workspace',
      scopeId: 'workspace-1',
      role: 'admin',
      effect: 'allow',
      createdBy: BOB,
      now,
    })
    expect(grant).toEqual({
      id: 'grant-1',
      principalKind: 'user',
      principalId: ALICE,
      scopeKind: 'workspace',
      scopeId: 'workspace-1',
      role: 'admin',
      effect: 'allow',
      createdBy: BOB,
      createdAt: now,
    })

    expect(await grants.listForScope('workspace', 'workspace-1')).toEqual([grant])
    expect(await grants.listForPrincipal('user', ALICE)).toEqual([grant])
  })

  it('reuses the same principal row for the same (kind, refId) across two grants', async () => {
    await grants.create({
      id: 'grant-1',
      principalKind: 'user',
      principalId: ALICE,
      scopeKind: 'workspace',
      scopeId: 'workspace-1',
      role: 'editor',
      effect: 'allow',
      createdBy: null,
      now,
    })
    await grants.create({
      id: 'grant-2',
      principalKind: 'user',
      principalId: ALICE,
      scopeKind: 'workspace',
      scopeId: 'workspace-2',
      role: 'viewer',
      effect: 'allow',
      createdBy: null,
      now,
    })

    const principalRows = await database.pool.query(
      "SELECT id FROM principals WHERE kind = 'user' AND ref_id = $1",
      [ALICE],
    )
    expect(principalRows.rowCount).toBe(1)
    expect(await grants.listForPrincipal('user', ALICE)).toHaveLength(2)
  })

  it('creates a grant for the singleton public principal, seeded by the migration', async () => {
    const grant = await grants.create({
      id: 'grant-public',
      principalKind: 'public',
      principalId: null,
      scopeKind: 'workspace',
      scopeId: 'workspace-1',
      role: 'viewer',
      effect: 'allow',
      createdBy: null,
      now,
    })
    expect(grant.principalKind).toBe('public')
    expect(grant.principalId).toBeNull()
    expect(await grants.listForPrincipal('public', null)).toEqual([grant])

    const principalRows = await database.pool.query(
      "SELECT id FROM principals WHERE kind = 'public'",
    )
    expect(principalRows.rowCount).toBe(1)
  })

  it('lists grants at the singleton instance scope, where scopeId is null', async () => {
    const grant = await grants.create({
      id: 'grant-instance',
      principalKind: 'user',
      principalId: ALICE,
      scopeKind: 'instance',
      scopeId: null,
      role: 'admin',
      effect: 'allow',
      createdBy: null,
      now,
    })
    expect(await grants.listForScope('instance', null)).toEqual([grant])
  })

  it('deletes a grant', async () => {
    await grants.create({
      id: 'grant-1',
      principalKind: 'user',
      principalId: ALICE,
      scopeKind: 'document',
      scopeId: 'doc-1',
      role: 'viewer',
      effect: 'deny',
      createdBy: null,
      now,
    })
    await grants.delete('grant-1')
    expect(await grants.listForScope('document', 'doc-1')).toEqual([])
  })

  it('resolves the race when several callers create a grant for the same brand-new principal concurrently', async () => {
    // All start from an empty `principals` table for this (kind, refId) — exactly one insert wins
    // the unique (kind, ref_id) constraint, and every other caller must fall back to re-reading it,
    // per `ensurePrincipal` in grant-repository.ts. A high fan-out makes that fallback path near
    // certain to run at least once, rather than relying on two calls happening to interleave.
    const attempts = Array.from({ length: 20 }, (_, i) =>
      grants.create({
        id: `grant-${i}`,
        principalKind: 'group',
        principalId: 'group-1',
        scopeKind: 'workspace',
        scopeId: `workspace-${i}`,
        role: 'viewer',
        effect: 'allow',
        createdBy: null,
        now,
      }),
    )
    const results = await Promise.all(attempts)
    for (const result of results) {
      expect(result.principalId).toBe('group-1')
    }

    const principalRows = await database.pool.query(
      "SELECT id FROM principals WHERE kind = 'group' AND ref_id = 'group-1'",
    )
    expect(principalRows.rowCount).toBe(1)
  })

  /**
   * PostgreSQL allows 65,535 bound parameters per statement and each selector
   * spends two, so a workspace of more than about thirty-three thousand
   * documents used to make this throw — which broke the flat document list as
   * surely as it broke search, because both materialise a whole workspace's
   * permissions at once (`visibleDocumentIds`).
   */
  it('answers about more scopes than one statement can bind', async () => {
    await grants.create({
      id: 'grant-many',
      principalKind: 'user',
      principalId: ALICE,
      scopeKind: 'document',
      scopeId: 'document-20000',
      role: 'viewer',
      effect: 'allow',
      createdBy: null,
      now,
    })

    const scopes = Array.from({ length: 40_000 }, (_unused, index) => ({
      kind: 'document' as const,
      id: `document-${index}`,
    }))

    const found = await grants.listForScopes(scopes)
    expect(found.map((grant) => grant.scopeId)).toEqual(['document-20000'])
  }, 30_000)
})
