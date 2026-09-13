import { beforeEach, describe, expect, it } from 'vitest'
import {
  documentId,
  groupPrincipal,
  PUBLIC_PRINCIPAL,
  userPrincipal,
  userId,
  workspaceId,
} from '@quill/domain'
import type { GroupId, Principal } from '@quill/domain'

import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { getWorkspaceTree } from './get-workspace-tree.ts'
import type { TreeNode } from './get-workspace-tree.ts'
import { aShortId } from '../test-support/fakes.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const MISSING_WORKSPACE = workspaceId('00000000-0000-4000-8000-0000000001ff')
const READER = userId('00000000-0000-4000-8000-000000000001')
const PARENT = documentId('00000000-0000-4000-8000-000000000201')
const CHILD = documentId('00000000-0000-4000-8000-000000000202')
const SECRET = documentId('00000000-0000-4000-8000-000000000203')

const PLATFORM = '00000000-0000-4000-8000-000000000501' as GroupId

const identities: readonly Principal[] = [userPrincipal(READER), PUBLIC_PRINCIPAL]
const withGroup: readonly Principal[] = [
  userPrincipal(READER),
  groupPrincipal(PLATFORM),
  PUBLIC_PRINCIPAL,
]

let uow: InMemoryUnitOfWork

const titles = (nodes: readonly TreeNode[]): unknown =>
  nodes.map((node) => ({ title: node.title, children: titles(node.children) }))

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  await uow.repos.units.create({
    id: 'acme',
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: NOW,
  })
  await uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Engineering',
    slug: 'engineering',
    now: NOW,
  })
  for (const [id, name] of [
    ['architecture', 'Architecture'],
    ['runbooks', 'Runbooks'],
  ] as const) {
    await uow.repos.collections.create({
      id,
      workspaceId: WORKSPACE,
      name,
      slug: id,
      now: NOW,
    })
  }
  for (const [id, parentId, title] of [
    [PARENT, null, 'Authentication'],
    [CHILD, PARENT, 'Token exchange'],
    [SECRET, null, 'Salaries'],
  ] as const) {
    await uow.repos.documents.create({
      id,
      shortId: aShortId(),
      workspaceId: WORKSPACE,
      collectionId: 'architecture',
      parentId,
      slug: title.toLowerCase(),
      path: `architecture/${title}.md`,
      title,
      status: 'published',
      templateId: null,
      templateVersion: null,
      now: NOW,
    })
  }
})

describe('getWorkspaceTree', () => {
  it('nests documents under their parents, collection by collection', async () => {
    const result = await getWorkspaceTree(
      { uow },
      {
        workspaceId: WORKSPACE,
        identities,
        seesEverything: true,
      },
    )
    expect(result.kind).toBe('tree')
    if (result.kind !== 'tree') return
    expect(result.collections.map((collection) => collection.name)).toEqual([
      'Architecture',
      'Runbooks',
    ])
    expect(titles(result.collections[0]?.documents ?? [])).toEqual([
      { title: 'Authentication', children: [{ title: 'Token exchange', children: [] }] },
      { title: 'Salaries', children: [] },
    ])
    expect(result.collections[1]?.documents).toEqual([])
  })

  it('shows a reader only the documents their grants reach', async () => {
    await uow.repos.grants.create({
      id: 'grant-1',
      principalKind: 'user',
      principalId: READER,
      scopeKind: 'workspace',
      scopeId: WORKSPACE,
      role: 'viewer',
      effect: 'allow',
      createdBy: null,
      now: NOW,
    })
    await uow.repos.grants.create({
      id: 'grant-2',
      principalKind: 'user',
      principalId: READER,
      scopeKind: 'document',
      scopeId: SECRET,
      role: 'viewer',
      effect: 'deny',
      createdBy: null,
      now: NOW,
    })
    await uow.repos.grants.create({
      id: 'grant-3',
      principalKind: 'user',
      principalId: userId('00000000-0000-4000-8000-0000000000ff'),
      scopeKind: 'document',
      scopeId: SECRET,
      role: 'owner',
      effect: 'allow',
      createdBy: null,
      now: NOW,
    })

    const result = await getWorkspaceTree(
      { uow },
      {
        workspaceId: WORKSPACE,
        identities,
        seesEverything: false,
      },
    )
    expect(result.kind).toBe('tree')
    if (result.kind !== 'tree') return
    expect(titles(result.collections[0]?.documents ?? [])).toEqual([
      { title: 'Authentication', children: [{ title: 'Token exchange', children: [] }] },
    ])
  })

  it('hides a document denied to the reader even when a group of theirs is granted the collection', async () => {
    await uow.repos.grants.create({
      id: 'grant-1',
      principalKind: 'group',
      principalId: PLATFORM,
      scopeKind: 'collection',
      scopeId: 'architecture',
      role: 'editor',
      effect: 'allow',
      createdBy: null,
      now: NOW,
    })
    await uow.repos.grants.create({
      id: 'grant-2',
      principalKind: 'user',
      principalId: READER,
      scopeKind: 'document',
      scopeId: SECRET,
      role: 'viewer',
      effect: 'deny',
      createdBy: null,
      now: NOW,
    })

    const result = await getWorkspaceTree(
      { uow },
      { workspaceId: WORKSPACE, identities: withGroup, seesEverything: false },
    )
    expect(result.kind === 'tree' && titles(result.collections[0]?.documents ?? [])).toEqual([
      { title: 'Authentication', children: [{ title: 'Token exchange', children: [] }] },
    ])
  })

  it('lets a public grant widen a reader’s tree and never narrow it', async () => {
    await uow.repos.grants.create({
      id: 'grant-1',
      principalKind: 'user',
      principalId: READER,
      scopeKind: 'document',
      scopeId: PARENT,
      role: 'editor',
      effect: 'allow',
      createdBy: null,
      now: NOW,
    })
    await uow.repos.grants.create({
      id: 'grant-2',
      principalKind: 'public',
      principalId: null,
      scopeKind: 'collection',
      scopeId: 'architecture',
      role: 'viewer',
      effect: 'allow',
      createdBy: null,
      now: NOW,
    })

    const result = await getWorkspaceTree(
      { uow },
      { workspaceId: WORKSPACE, identities, seesEverything: false },
    )
    expect(result.kind === 'tree' && titles(result.collections[0]?.documents ?? [])).toEqual([
      { title: 'Authentication', children: [{ title: 'Token exchange', children: [] }] },
      { title: 'Salaries', children: [] },
    ])
  })

  it('keeps a document carved out of a public collection visible to members', async () => {
    await uow.repos.grants.create({
      id: 'grant-1',
      principalKind: 'public',
      principalId: null,
      scopeKind: 'collection',
      scopeId: 'architecture',
      role: 'viewer',
      effect: 'allow',
      createdBy: null,
      now: NOW,
    })
    await uow.repos.grants.create({
      id: 'grant-2',
      principalKind: 'public',
      principalId: null,
      scopeKind: 'document',
      scopeId: SECRET,
      role: 'viewer',
      effect: 'deny',
      createdBy: null,
      now: NOW,
    })
    await uow.repos.grants.create({
      id: 'grant-3',
      principalKind: 'user',
      principalId: READER,
      scopeKind: 'workspace',
      scopeId: WORKSPACE,
      role: 'editor',
      effect: 'allow',
      createdBy: null,
      now: NOW,
    })

    const asMember = await getWorkspaceTree(
      { uow },
      { workspaceId: WORKSPACE, identities, seesEverything: false },
    )
    expect(asMember.kind === 'tree' && titles(asMember.collections[0]?.documents ?? [])).toEqual([
      { title: 'Authentication', children: [{ title: 'Token exchange', children: [] }] },
      { title: 'Salaries', children: [] },
    ])

    const asAnonymous = await getWorkspaceTree(
      { uow },
      { workspaceId: WORKSPACE, identities: [PUBLIC_PRINCIPAL], seesEverything: false },
    )
    expect(
      asAnonymous.kind === 'tree' && titles(asAnonymous.collections[0]?.documents ?? []),
    ).toEqual([{ title: 'Authentication', children: [{ title: 'Token exchange', children: [] }] }])
  })

  it('lifts a document whose parent the reader cannot see to the top of its collection', async () => {
    await uow.repos.grants.create({
      id: 'grant-1',
      principalKind: 'user',
      principalId: READER,
      scopeKind: 'document',
      scopeId: CHILD,
      role: 'viewer',
      effect: 'allow',
      createdBy: null,
      now: NOW,
    })

    const result = await getWorkspaceTree(
      { uow },
      {
        workspaceId: WORKSPACE,
        identities,
        seesEverything: false,
      },
    )
    expect(result.kind === 'tree' && titles(result.collections[0]?.documents ?? [])).toEqual([
      { title: 'Token exchange', children: [] },
    ])
  })

  it('reports a workspace it cannot find', async () => {
    expect(
      await getWorkspaceTree(
        { uow },
        {
          workspaceId: MISSING_WORKSPACE,
          identities,
          seesEverything: true,
        },
      ),
    ).toEqual({ kind: 'workspace-not-found', workspaceId: MISSING_WORKSPACE })
  })

  it('reports a broken tree rather than looping on it', async () => {
    await uow.repos.units.create({
      id: 'loop',
      parentId: 'loop',
      name: 'Loop',
      slug: 'loop',
      label: 'team',
      now: NOW,
    })
    await uow.repos.workspaces.rename(WORKSPACE, 'Engineering')
    const looping = workspaceId('00000000-0000-4000-8000-000000000102')
    await uow.repos.workspaces.create({
      id: looping,
      unitId: 'loop',
      name: 'Looping',
      slug: 'looping',
      now: NOW,
    })

    expect(
      await getWorkspaceTree(
        { uow },
        {
          workspaceId: looping,
          identities,
          seesEverything: false,
        },
      ),
    ).toEqual({ kind: 'broken-tree', failure: { kind: 'unit-cycle', unitId: 'loop' } })
  })
})
