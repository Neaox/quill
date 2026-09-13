import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, userId, workspaceId } from '@quill/domain'

import { aShortId, createFakeClock, createFakeIdGenerator } from './../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import {
  COLLECTION_AUDIT_EVENTS,
  createCollection,
  deleteCollection,
  listCollections,
  renameCollection,
} from './collections.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const ACTOR = userId('00000000-0000-4000-8000-000000000001')

let uow: InMemoryUnitOfWork
let deps: {
  uow: InMemoryUnitOfWork
  clock: ReturnType<typeof createFakeClock>
  ids: ReturnType<typeof createFakeIdGenerator>
}
let audited: { type: string; targetId: string; metadata: unknown }[]

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  audited = []
  // The in-memory unit of work keeps no audit rows, and the rows are part of
  // what these commands are for (ADR-011: administrative actions are audited).
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
  await uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Engineering',
    slug: 'engineering',
    now: NOW,
  })
})

describe('createCollection', () => {
  it('derives a slug from the name and audits the creation', async () => {
    const result = await createCollection(deps, {
      workspaceId: WORKSPACE,
      name: 'Runbooks & Playbooks',
      createdBy: ACTOR,
    })
    if (result.kind !== 'created') throw new Error(`unexpected result: ${result.kind}`)

    expect(result.collection).toMatchObject({
      workspaceId: WORKSPACE,
      name: 'Runbooks & Playbooks',
      slug: 'runbooks-playbooks',
    })
    expect(audited).toEqual([
      {
        id: expect.any(String),
        type: COLLECTION_AUDIT_EVENTS.created,
        actorUserId: ACTOR,
        targetType: 'collection',
        targetId: result.collection.id,
        metadata: {
          workspaceId: WORKSPACE,
          name: 'Runbooks & Playbooks',
          slug: 'runbooks-playbooks',
        },
        now: NOW,
      },
    ])
  })

  it('refuses a name whose slug is already taken in this workspace', async () => {
    await createCollection(deps, { workspaceId: WORKSPACE, name: 'Runbooks', createdBy: ACTOR })
    // A different spelling, the same slug: `Run Books` and `run books` both
    // derive `run-books`, and the slug is what the workspace holds unique.
    await createCollection(deps, { workspaceId: WORKSPACE, name: 'Run Books', createdBy: ACTOR })
    expect(
      await createCollection(deps, { workspaceId: WORKSPACE, name: 'run books', createdBy: ACTOR }),
    ).toEqual({ kind: 'slug-taken', slug: 'run-books' })
  })

  it('lets another workspace use the same name', async () => {
    const other = workspaceId('00000000-0000-4000-8000-000000000102')
    await uow.repos.workspaces.create({
      id: other,
      unitId: 'acme',
      name: 'Design',
      slug: 'design',
      now: NOW,
    })
    await createCollection(deps, { workspaceId: WORKSPACE, name: 'Runbooks', createdBy: ACTOR })
    expect(
      (await createCollection(deps, { workspaceId: other, name: 'Runbooks', createdBy: ACTOR }))
        .kind,
    ).toBe('created')
  })
})

describe('renameCollection', () => {
  it('changes the name and leaves the slug alone', async () => {
    const created = await createCollection(deps, {
      workspaceId: WORKSPACE,
      name: 'Runbooks',
      createdBy: ACTOR,
    })
    if (created.kind !== 'created') throw new Error('expected a collection')
    audited.length = 0

    const renamed = await renameCollection(deps, {
      collectionId: created.collection.id,
      name: 'Operational runbooks',
      renamedBy: ACTOR,
    })
    if (renamed.kind !== 'renamed') throw new Error(`unexpected result: ${renamed.kind}`)

    // Documents are addressed by id (AGENTS.md rule 8), so a rename moves
    // nothing: the slug is what a published path would have been built from.
    expect(renamed.collection).toMatchObject({ name: 'Operational runbooks', slug: 'runbooks' })
    expect(audited[0]).toMatchObject({
      type: COLLECTION_AUDIT_EVENTS.renamed,
      metadata: { from: 'Runbooks', to: 'Operational runbooks', slug: 'runbooks' },
    })
  })

  it('answers not-found for a collection that does not exist', async () => {
    expect(
      await renameCollection(deps, { collectionId: 'nope', name: 'Anything', renamedBy: ACTOR }),
    ).toEqual({ kind: 'not-found' })
  })
})

describe('deleteCollection', () => {
  async function collection(name = 'Runbooks'): Promise<string> {
    const created = await createCollection(deps, {
      workspaceId: WORKSPACE,
      name,
      createdBy: ACTOR,
    })
    if (created.kind !== 'created') throw new Error('expected a collection')
    audited.length = 0
    return created.collection.id
  }

  it('deletes an empty collection and audits it', async () => {
    const id = await collection()
    expect(await deleteCollection(deps, { collectionId: id, deletedBy: ACTOR })).toEqual({
      kind: 'deleted',
    })
    expect(await uow.repos.collections.findById(id)).toBeNull()
    expect(audited[0]).toMatchObject({ type: COLLECTION_AUDIT_EVENTS.deleted, targetId: id })
  })

  /**
   * `collection_id` is nullable, so deleting the row would leave its
   * documents outside every collection — and a document outside a collection
   * has no scope chain at all (ADR-012), which is unreachable rather than
   * public, but unreachable for its owners too.
   */
  it('refuses while the collection still holds documents', async () => {
    const id = await collection()
    await uow.repos.documents.create({
      id: documentId('00000000-0000-4000-8000-000000000201'),
      shortId: aShortId(),
      workspaceId: WORKSPACE,
      collectionId: id,
      parentId: null,
      slug: 'runbook',
      path: 'runbooks/runbook.md',
      title: 'A runbook',
      status: 'draft',
      templateId: null,
      templateVersion: null,
      now: NOW,
    })

    expect(await deleteCollection(deps, { collectionId: id, deletedBy: ACTOR })).toEqual({
      kind: 'not-empty',
      documents: 1,
    })
    expect(await uow.repos.collections.findById(id)).not.toBeNull()
    expect(audited).toEqual([])
  })

  it('answers not-found for a collection that does not exist', async () => {
    expect(await deleteCollection(deps, { collectionId: 'nope', deletedBy: ACTOR })).toEqual({
      kind: 'not-found',
    })
  })
})

describe('listCollections', () => {
  it('lists a workspace’s collections by name', async () => {
    for (const name of ['Runbooks', 'Architecture', 'Decisions']) {
      await createCollection(deps, { workspaceId: WORKSPACE, name, createdBy: ACTOR })
    }
    expect(
      (await listCollections(deps, { workspaceId: WORKSPACE })).map((row) => row.name),
    ).toEqual(['Architecture', 'Decisions', 'Runbooks'])
  })
})
