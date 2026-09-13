import { createInMemoryUnitOfWork } from '@quill/application/test-support'
import type { UnitOfWork } from '@quill/application'
import {
  collectionId as toCollectionId,
  documentId as toDocumentId,
  groupPrincipal,
  PUBLIC_PRINCIPAL,
  shareLinkPrincipal,
  userPrincipal,
  workspaceId as toWorkspaceId,
} from '@quill/domain'
import type { CollectionId, DocumentId, ShortId, UserId, WorkspaceId } from '@quill/domain'
import { visibilityFilter } from '@quill/search'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  createVisibleDocumentResolver,
  principalsFromKeys,
  WORKSPACES_PER_BATCH,
} from './visible-documents.ts'

/**
 * The seam between the search adapter and ADR-012: what a filter's principal
 * keys mean, who bypasses resolution, and what happens when a workspace is
 * missing or its tree does not hold together.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const MEMBER = '00000000-0000-4000-8000-0000000000a1' as UserId
const ADMIN = '00000000-0000-4000-8000-0000000000a2' as UserId
const WORKSPACE = toWorkspaceId('11111111-1111-4111-8111-111111111111')
const COLLECTION = toCollectionId('22222222-2222-4222-8222-222222222222')
const DOCUMENT = toDocumentId('33333333-3333-4333-8333-333333333333')
const ORPHAN_PARENT = toDocumentId('44444444-4444-4444-8444-444444444444')
const SECOND_DOCUMENT = toDocumentId('33333333-3333-4333-8333-333333333334')

let uow: UnitOfWork

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  const { repos } = uow
  await repos.users.create({ id: MEMBER, email: 'member@example.com', displayName: 'M', now: NOW })
  await repos.users.create({ id: ADMIN, email: 'admin@example.com', displayName: 'A', now: NOW })
  await repos.users.setInstanceAdmin(ADMIN, true)

  const unit = await repos.units.create({
    id: 'unit',
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: NOW,
  })
  await repos.workspaces.create({
    id: WORKSPACE,
    unitId: unit.id,
    name: 'Engineering',
    slug: 'engineering',
    now: NOW,
  })
  await repos.collections.create({
    id: COLLECTION,
    workspaceId: WORKSPACE,
    name: 'Runbooks',
    slug: 'runbooks',
    now: NOW,
  })
})

async function addDocument(id: DocumentId, parentId: DocumentId | null): Promise<void> {
  await uow.repos.documents.create({
    id,
    shortId: id.slice(-10) as ShortId,
    workspaceId: WORKSPACE,
    collectionId: COLLECTION,
    parentId,
    slug: 'a-document',
    path: `runbooks/${id.slice(-4)}.md`,
    title: 'A document',
    status: 'published',
    templateId: null,
    templateVersion: null,
    now: NOW,
  })
}

describe('principalsFromKeys', () => {
  it('reads back every principal a filter can carry', () => {
    expect([
      ...principalsFromKeys(['public', `user:${MEMBER}`, 'group:g1', 'share-link:s1']),
    ]).toEqual([
      PUBLIC_PRINCIPAL,
      userPrincipal(MEMBER),
      groupPrincipal('g1' as never),
      shareLinkPrincipal('s1' as never),
    ])
  })

  it('drops a key it does not recognise rather than guessing at it', () => {
    expect([...principalsFromKeys(['robot:1', 'nonsense', 'user:', ''])]).toEqual([])
  })
})

describe('resolving what a search may look at', () => {
  it('gives an instance admin everything, without walking a single workspace', async () => {
    const resolver = createVisibleDocumentResolver({ uow })
    const resolved = await resolver.resolve({
      filter: visibilityFilter([WORKSPACE], [userPrincipal(ADMIN), PUBLIC_PRINCIPAL]),
      from: 0,
    })
    expect(resolved.visible).toEqual({ kind: 'everything' })
    expect(resolved.workspaceIds).toEqual([WORKSPACE])
    expect(resolved.nextFrom).toBeNull()
  })

  it('gives a member the documents the domain says they may view', async () => {
    await addDocument(DOCUMENT, null)
    await uow.repos.grants.create({
      id: 'grant-1' as never,
      principalKind: 'user',
      principalId: MEMBER,
      scopeKind: 'workspace',
      scopeId: WORKSPACE,
      role: 'viewer',
      effect: 'allow',
      createdBy: null,
      now: NOW,
    })

    const resolver = createVisibleDocumentResolver({ uow })
    const resolved = await resolver.resolve({
      filter: visibilityFilter([WORKSPACE], [userPrincipal(MEMBER), PUBLIC_PRINCIPAL]),
      from: 0,
    })
    // Every document in the workspace is visible, so it is named rather than
    // enumerated: no document id travels to the query at all.
    expect(resolved.visible).toEqual({
      kind: 'scoped',
      wholeWorkspaces: [WORKSPACE],
      documentIds: [],
    })
  })

  it('gives a principal with no grant nothing', async () => {
    await addDocument(DOCUMENT, null)
    const resolver = createVisibleDocumentResolver({ uow })
    const resolved = await resolver.resolve({
      filter: visibilityFilter([WORKSPACE], [userPrincipal(MEMBER), PUBLIC_PRINCIPAL]),
      from: 0,
    })
    expect(resolved.visible).toEqual({ kind: 'scoped', wholeWorkspaces: [], documentIds: [] })
  })

  it('contributes nothing for a workspace that is not there', async () => {
    const resolver = createVisibleDocumentResolver({ uow })
    const resolved = await resolver.resolve({
      filter: visibilityFilter(
        [toWorkspaceId('99999999-9999-4999-8999-999999999999')],
        [userPrincipal(MEMBER)],
      ),
      from: 0,
    })
    expect(resolved.visible).toEqual({ kind: 'scoped', wholeWorkspaces: [], documentIds: [] })
  })

  it('hides a workspace whose tree does not hold together, rather than leaking it', async () => {
    await addDocument(DOCUMENT, ORPHAN_PARENT)
    const resolver = createVisibleDocumentResolver({ uow })
    const resolved = await resolver.resolve({
      filter: visibilityFilter([WORKSPACE], [userPrincipal(MEMBER)]),
      from: 0,
    })
    expect(resolved.visible).toEqual({ kind: 'scoped', wholeWorkspaces: [], documentIds: [] })
  })
})

/** A workspace granted to the member, with one document in it. */
async function anotherWorkspace(index: number): Promise<WorkspaceId> {
  const { repos } = uow
  const workspace = await repos.workspaces.create({
    id: toWorkspaceId(`5555555${index}-5555-4555-8555-55555555555${index}`),
    unitId: 'unit',
    name: `Workspace ${index}`,
    slug: `workspace-${index}`,
    now: NOW,
  })
  const collection = await repos.collections.create({
    id: toCollectionId(`6666666${index}-6666-4666-8666-66666666666${index}`),
    workspaceId: workspace.id as WorkspaceId,
    name: 'Runbooks',
    slug: 'runbooks',
    now: NOW,
  })
  await repos.documents.create({
    id: toDocumentId(`7777777${index}-7777-4777-8777-77777777777${index}`),
    shortId: `short${index}0000`.slice(0, 10) as ShortId,
    workspaceId: workspace.id as WorkspaceId,
    collectionId: collection.id as CollectionId,
    parentId: null,
    slug: 'a-document',
    path: `runbooks/${index}.md`,
    title: 'A document',
    status: 'published',
    templateId: null,
    templateVersion: null,
    now: NOW,
  })
  return workspace.id as WorkspaceId
}

async function allow(scopeId: string, scopeKind: 'workspace' | 'document'): Promise<void> {
  await uow.repos.grants.create({
    id: `grant-${scopeKind}-${scopeId}` as never,
    principalKind: 'user',
    principalId: MEMBER,
    scopeKind,
    scopeId,
    role: 'viewer',
    effect: 'allow',
    createdBy: null,
    now: NOW,
  })
}

describe('a workspace where not everything is visible', () => {
  it('lists the documents that are, rather than naming the workspace', async () => {
    await addDocument(DOCUMENT, null)
    await addDocument(SECOND_DOCUMENT, null)
    await allow(WORKSPACE, 'workspace')
    await uow.repos.grants.create({
      id: 'deny-1' as never,
      principalKind: 'user',
      principalId: MEMBER,
      scopeKind: 'document',
      scopeId: SECOND_DOCUMENT,
      role: 'viewer',
      effect: 'deny',
      createdBy: null,
      now: NOW,
    })

    const resolved = await createVisibleDocumentResolver({ uow }).resolve({
      filter: visibilityFilter([WORKSPACE], [userPrincipal(MEMBER)]),
      from: 0,
    })
    expect(resolved.visible).toEqual({
      kind: 'scoped',
      wholeWorkspaces: [],
      documentIds: [DOCUMENT],
    })
  })
})

describe('how many workspaces one request walks', () => {
  it('walks the current workspace first, then a bounded batch, and says where the next one starts', async () => {
    await addDocument(DOCUMENT, null)
    await allow(WORKSPACE, 'workspace')
    const others: WorkspaceId[] = []
    for (let index = 0; index < WORKSPACES_PER_BATCH + 1; index += 1) {
      const workspace = await anotherWorkspace(index)
      await allow(workspace, 'workspace')
      others.push(workspace)
    }

    const resolver = createVisibleDocumentResolver({ uow })
    const filter = visibilityFilter([...others, WORKSPACE], [userPrincipal(MEMBER)])

    const first = await resolver.resolve({ filter, currentWorkspaceId: WORKSPACE, from: 0 })
    expect(first.workspaceIds).toHaveLength(WORKSPACES_PER_BATCH)
    // The workspace the caller is in is walked first, however the filter listed it.
    expect(first.workspaceIds[0]).toBe(WORKSPACE)
    expect(first.nextFrom).toBe(WORKSPACES_PER_BATCH)

    const second = await resolver.resolve({
      filter,
      currentWorkspaceId: WORKSPACE,
      from: WORKSPACES_PER_BATCH,
    })
    // Seven workspaces in all: five in the first batch, two in this one.
    expect(second.workspaceIds).toHaveLength(2)
    expect(second.nextFrom).toBeNull()
  }, 30_000)

  it('resolves nothing at all once the batches have run out', async () => {
    const resolved = await createVisibleDocumentResolver({ uow }).resolve({
      filter: visibilityFilter([WORKSPACE], [userPrincipal(MEMBER)]),
      from: 99,
    })
    expect(resolved).toEqual({
      visible: { kind: 'scoped', wholeWorkspaces: [], documentIds: [] },
      workspaceIds: [],
      nextFrom: null,
    })
  })

  it('drops a current workspace the filter does not carry rather than searching it', async () => {
    await addDocument(DOCUMENT, null)
    await allow(WORKSPACE, 'workspace')
    const elsewhere = toWorkspaceId('88888888-8888-4888-8888-888888888888')

    const resolved = await createVisibleDocumentResolver({ uow }).resolve({
      filter: visibilityFilter([WORKSPACE], [userPrincipal(MEMBER)]),
      currentWorkspaceId: elsewhere,
      from: 0,
    })
    expect(resolved.workspaceIds).toEqual([WORKSPACE])
  })
})
