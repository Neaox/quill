import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, workspaceId } from '@quill/domain'

import { aShortId, createFakeClock } from '../test-support/fakes.ts'
import type { FakeClock } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import {
  resolveDocumentReference,
  resolveWorkspaceReference,
  WORKSPACE_SLUG_HISTORY_TTL_MS,
} from './resolve-reference.ts'
import type { ResolveReferenceDependencies } from './resolve-reference.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const OTHER_WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000102')
const DOC = documentId('00000000-0000-4000-8000-000000000201')
const KEY = aShortId(7)

let uow: InMemoryUnitOfWork
let clock: FakeClock
let deps: ResolveReferenceDependencies

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  clock = createFakeClock(NOW)
  deps = { uow, clock }
  await uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Engineering',
    slug: 'engineering',
    now: NOW,
  })
  await uow.repos.documents.create({
    id: DOC,
    shortId: KEY,
    workspaceId: WORKSPACE,
    collectionId: 'architecture',
    parentId: null,
    slug: 'authentication',
    path: 'architecture/authentication.md',
    title: 'Authentication',
    status: 'published',
    templateId: null,
    templateVersion: null,
    now: NOW,
  })
})

describe('resolveDocumentReference', () => {
  it('resolves the words and the key, and reports the workspace the document is in', async () => {
    const resolved = await resolveDocumentReference(deps, {
      reference: `authentication-${KEY}`,
    })
    expect(resolved).toMatchObject({
      kind: 'resolved',
      matched: 'short-id',
      document: { id: DOC },
      workspace: { id: WORKSPACE, slug: 'engineering' },
    })
  })

  it('ignores the words entirely, so a stale title still resolves', async () => {
    const resolved = await resolveDocumentReference(deps, { reference: `some-old-title-${KEY}` })
    expect(resolved.kind === 'resolved' && resolved.document.id).toBe(DOC)
  })

  it('resolves a bare key across the instance, and names the workspace the document is really in', async () => {
    await uow.repos.workspaces.create({
      id: OTHER_WORKSPACE,
      unitId: 'acme',
      name: 'Platform',
      slug: 'platform',
      now: NOW,
    })
    const elsewhere = documentId('00000000-0000-4000-8000-000000000202')
    await uow.repos.documents.create({
      id: elsewhere,
      shortId: aShortId(8),
      workspaceId: OTHER_WORKSPACE,
      collectionId: 'runbooks',
      parentId: null,
      slug: 'failover',
      path: 'runbooks/failover.md',
      title: 'Failover',
      status: 'published',
      templateId: null,
      templateVersion: null,
      now: NOW,
    })

    // The key alone is enough: nothing about the workspace is needed to
    // resolve it, and the answer says which workspace to correct the URL to.
    expect(await resolveDocumentReference(deps, { reference: aShortId(8) })).toMatchObject({
      kind: 'resolved',
      document: { id: elsewhere },
      workspace: { id: OTHER_WORKSPACE, slug: 'platform' },
    })
  })

  it('resolves the UUID form for ever (ADR-033)', async () => {
    expect(await resolveDocumentReference(deps, { reference: DOC })).toMatchObject({
      kind: 'resolved',
      matched: 'uuid',
    })
  })

  it('answers not-found for a key nothing holds, an id nothing holds, and a reference that is neither', async () => {
    expect(await resolveDocumentReference(deps, { reference: aShortId(99) })).toEqual({
      kind: 'not-found',
      reference: aShortId(99),
    })
    expect(
      await resolveDocumentReference(deps, {
        reference: documentId('00000000-0000-4000-8000-0000000009ff'),
      }),
    ).toMatchObject({ kind: 'not-found' })
    expect(await resolveDocumentReference(deps, { reference: 'getting-started' })).toEqual({
      kind: 'not-found',
      reference: 'getting-started',
    })
  })
})

describe('resolveWorkspaceReference', () => {
  it('resolves an id, and a slug', async () => {
    expect(await resolveWorkspaceReference(deps, { reference: WORKSPACE })).toMatchObject({
      kind: 'resolved',
      matched: 'uuid',
    })
    expect(await resolveWorkspaceReference(deps, { reference: 'engineering' })).toMatchObject({
      kind: 'resolved',
      matched: 'slug',
      workspace: { id: WORKSPACE },
    })
  })

  it('falls through to the slug when an id-shaped reference names nothing', async () => {
    await uow.repos.workspaces.create({
      id: OTHER_WORKSPACE,
      unitId: 'acme',
      name: 'Odd',
      slug: '00000000-0000-4000-8000-0000000009ff',
      now: NOW,
    })
    expect(
      await resolveWorkspaceReference(deps, {
        reference: '00000000-0000-4000-8000-0000000009ff',
      }),
    ).toMatchObject({ kind: 'resolved', matched: 'slug', workspace: { id: OTHER_WORKSPACE } })
  })

  it('still resolves a slug the workspace retired within the year', async () => {
    await uow.repos.workspaceSlugHistory.record({
      workspaceId: WORKSPACE,
      slug: 'eng',
      now: NOW,
    })
    clock.advance(WORKSPACE_SLUG_HISTORY_TTL_MS - 1)
    expect(await resolveWorkspaceReference(deps, { reference: 'eng' })).toMatchObject({
      kind: 'resolved',
      matched: 'retired-slug',
      workspace: { id: WORKSPACE },
    })
  })

  it('stops resolving a slug retired longer ago than that', async () => {
    await uow.repos.workspaceSlugHistory.record({
      workspaceId: WORKSPACE,
      slug: 'eng',
      now: NOW,
    })
    clock.advance(WORKSPACE_SLUG_HISTORY_TTL_MS + 1)
    expect(await resolveWorkspaceReference(deps, { reference: 'eng' })).toEqual({
      kind: 'not-found',
      reference: 'eng',
    })
  })

  it('answers not-found for a slug nothing has ever used', async () => {
    expect(await resolveWorkspaceReference(deps, { reference: 'nope' })).toEqual({
      kind: 'not-found',
      reference: 'nope',
    })
  })
})
