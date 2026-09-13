import { beforeEach, describe, expect, it } from 'vitest'
import {
  documentId,
  groupPrincipal,
  PUBLIC_PRINCIPAL,
  shareLinkPrincipal,
  userPrincipal,
  userId,
  workspaceId,
} from '@quill/domain'
import type { GroupId, Principal, ShareLinkId } from '@quill/domain'

import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { listVisibleDocuments } from './list-visible-documents.ts'
import { aShortId } from '../test-support/fakes.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const MISSING_WORKSPACE = workspaceId('00000000-0000-4000-8000-0000000001ff')
const READER = userId('00000000-0000-4000-8000-000000000001')
const PLATFORM = '00000000-0000-4000-8000-000000000501' as GroupId
const PARENT = documentId('00000000-0000-4000-8000-000000000201')
const CHILD = documentId('00000000-0000-4000-8000-000000000202')
const SECRET = documentId('00000000-0000-4000-8000-000000000203')

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

async function visibleTitles(seesEverything = false): Promise<readonly string[]> {
  const result = await listVisibleDocuments(
    { uow },
    { workspaceId: WORKSPACE, identities, seesEverything },
  )
  if (result.kind !== 'documents') throw new Error(`unexpected result: ${result.kind}`)
  return result.documents.map((document) => document.title)
}

beforeEach(async () => {
  nextGrant = 0
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
  await uow.repos.collections.create({
    id: 'architecture',
    workspaceId: WORKSPACE,
    name: 'Architecture',
    slug: 'architecture',
    now: NOW,
  })
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

describe('listVisibleDocuments', () => {
  it('shows an instance admin every document without resolving anything', async () => {
    expect(await visibleTitles(true)).toEqual(['Authentication', 'Token exchange', 'Salaries'])
  })

  it('shows nothing to a reader with no grant at all', async () => {
    expect(await visibleTitles()).toEqual([])
  })

  it('withholds a document a deny on the reader carved out of a group grant', async () => {
    await grant({
      principalKind: 'group',
      principalId: PLATFORM,
      scopeKind: 'collection',
      scopeId: 'architecture',
      role: 'editor',
      effect: 'allow',
      createdBy: null,
    })
    await grant({
      principalKind: 'user',
      principalId: READER,
      scopeKind: 'document',
      scopeId: SECRET,
      role: 'viewer',
      effect: 'deny',
      createdBy: null,
    })

    expect(await visibleTitles()).toEqual(['Authentication', 'Token exchange'])
  })

  it('lets a public grant widen what a reader sees and never narrow it', async () => {
    await grant({
      principalKind: 'user',
      principalId: READER,
      scopeKind: 'document',
      scopeId: PARENT,
      role: 'editor',
      effect: 'allow',
      createdBy: null,
    })
    expect(await visibleTitles()).toEqual(['Authentication', 'Token exchange'])

    await grant({
      principalKind: 'public',
      principalId: null,
      scopeKind: 'workspace',
      scopeId: WORKSPACE,
      role: 'viewer',
      effect: 'allow',
      createdBy: null,
    })
    expect(await visibleTitles()).toEqual(['Authentication', 'Token exchange', 'Salaries'])
  })

  it('keeps a document carved out of a public collection visible to members', async () => {
    await grant({
      principalKind: 'public',
      principalId: null,
      scopeKind: 'collection',
      scopeId: 'architecture',
      role: 'viewer',
      effect: 'allow',
      createdBy: null,
    })
    await grant({
      principalKind: 'public',
      principalId: null,
      scopeKind: 'document',
      scopeId: SECRET,
      role: 'viewer',
      effect: 'deny',
      createdBy: null,
    })
    await grant({
      principalKind: 'user',
      principalId: READER,
      scopeKind: 'workspace',
      scopeId: WORKSPACE,
      role: 'editor',
      effect: 'allow',
      createdBy: null,
    })

    expect(await visibleTitles()).toEqual(['Authentication', 'Token exchange', 'Salaries'])

    // The same carve-out does take it off the public web.
    const anonymous = await listVisibleDocuments(
      { uow },
      { workspaceId: WORKSPACE, identities: [PUBLIC_PRINCIPAL], seesEverything: false },
    )
    expect(
      anonymous.kind === 'documents' && anonymous.documents.map((document) => document.title),
    ).toEqual(['Authentication', 'Token exchange'])
  })

  it('reports a workspace it cannot find', async () => {
    expect(
      await listVisibleDocuments(
        { uow },
        { workspaceId: MISSING_WORKSPACE, identities, seesEverything: true },
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
    const looping = workspaceId('00000000-0000-4000-8000-000000000102')
    await uow.repos.workspaces.create({
      id: looping,
      unitId: 'loop',
      name: 'Looping',
      slug: 'looping',
      now: NOW,
    })

    expect(
      await listVisibleDocuments(
        { uow },
        { workspaceId: looping, identities, seesEverything: false },
      ),
    ).toEqual({ kind: 'broken-tree', failure: { kind: 'unit-cycle', unitId: 'loop' } })
  })

  it('sees what a share link opens, and nothing else it was not given', async () => {
    const link = shareLinkPrincipal('00000000-0000-4000-8000-000000000601' as ShareLinkId)
    await grant({
      principalKind: 'share_link',
      principalId: '00000000-0000-4000-8000-000000000601',
      scopeKind: 'document',
      scopeId: PARENT,
      role: 'viewer',
      effect: 'allow',
      createdBy: null,
    })

    const result = await listVisibleDocuments(
      { uow },
      { workspaceId: WORKSPACE, identities: [link, PUBLIC_PRINCIPAL], seesEverything: false },
    )
    expect(result.kind).toBe('documents')
    expect(result.kind === 'documents' ? result.documents.map((row) => row.id) : []).toEqual([
      PARENT,
      CHILD,
    ])
  })
})
