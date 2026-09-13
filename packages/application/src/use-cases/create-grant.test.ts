import { beforeEach, describe, expect, it } from 'vitest'
import { collectionId, documentId, userId } from '@quill/domain'

import { createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { createGrant } from './create-grant.ts'
import type { CreateGrantCommand, CreateGrantDependencies } from './create-grant.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const ALICE = userId('00000000-0000-4000-8000-000000000001')
const ADMIN = userId('00000000-0000-4000-8000-000000000002')
const COLLECTION = collectionId('00000000-0000-4000-8000-000000000301')
const DOCUMENT = documentId('00000000-0000-4000-8000-000000000201')

let uow: InMemoryUnitOfWork
let deps: CreateGrantDependencies

function command(overrides: Partial<CreateGrantCommand> = {}): CreateGrantCommand {
  return {
    principalKind: 'user',
    principalId: ALICE,
    scopeKind: 'collection',
    scopeId: COLLECTION,
    role: 'editor',
    effect: 'allow',
    createdBy: ADMIN,
    ...overrides,
  }
}

beforeEach(() => {
  uow = createInMemoryUnitOfWork()
  deps = { uow, clock: createFakeClock(NOW), ids: createFakeIdGenerator() }
})

describe('createGrant', () => {
  it('stores a grant that satisfies the domain rules', async () => {
    const result = await createGrant(deps, command())

    expect(result.kind).toBe('created')
    if (result.kind !== 'created') return
    expect(result.grant).toMatchObject({
      principalKind: 'user',
      principalId: ALICE,
      scopeKind: 'collection',
      role: 'editor',
      effect: 'allow',
      createdBy: ADMIN,
    })
    expect(await uow.repos.grants.listForScope('collection', COLLECTION)).toHaveLength(1)
  })

  it('stores a deny at document scope', async () => {
    const result = await createGrant(
      deps,
      command({ scopeKind: 'document', scopeId: DOCUMENT, effect: 'deny', role: 'viewer' }),
    )
    expect(result.kind).toBe('created')
  })

  it('refuses a deny above document scope, and writes nothing', async () => {
    const result = await createGrant(deps, command({ effect: 'deny' }))

    expect(result).toEqual({
      kind: 'rejected',
      violations: [{ kind: 'deny-outside-document-scope', scope: 'collection' }],
    })
    expect(await uow.repos.grants.listForScope('collection', COLLECTION)).toEqual([])
  })

  it('refuses to make the public principal anything above a viewer', async () => {
    const result = await createGrant(
      deps,
      command({ principalKind: 'public', principalId: null, role: 'owner' }),
    )

    expect(result).toEqual({
      kind: 'rejected',
      violations: [{ kind: 'public-principal-above-viewer', role: 'owner' }],
    })
  })

  it('reports every violation at once', async () => {
    const result = await createGrant(
      deps,
      command({ principalKind: 'public', principalId: null, role: 'owner', effect: 'deny' }),
    )

    expect(result.kind === 'rejected' && result.violations.map((one) => one.kind)).toEqual([
      'deny-outside-document-scope',
      'public-principal-above-viewer',
    ])
  })

  it('refuses a grant whose principal names no id', async () => {
    expect(await createGrant(deps, command({ principalId: null }))).toEqual({ kind: 'malformed' })
  })

  it('refuses a grant whose scope names no id', async () => {
    expect(await createGrant(deps, command({ scopeId: null }))).toEqual({ kind: 'malformed' })
  })
})
