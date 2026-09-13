import { beforeEach, describe, expect, it } from 'vitest'
import { aShortId, createInMemoryUnitOfWork } from '@quill/application/test-support'
import type { InMemoryUnitOfWork } from '@quill/application/test-support'
import { documentId, userId, workspaceId } from '@quill/domain'
import type { FastifyRequest } from 'fastify'

import type { AppDependencies } from '../dependencies.ts'
import { AppError } from '../errors.ts'
import {
  authorizerFor,
  requireDocumentAccess,
  requireInstanceAdmin,
  requireWorkspaceAccess,
  requestPrincipal,
} from './authorization.ts'

/**
 * How a route asks what a request may do, and what it answers when the
 * tenancy tree cannot place the document at all.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const USER = userId('00000000-0000-4000-8000-000000000001')
const ADMIN = userId('00000000-0000-4000-8000-0000000000ad')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const DOC = documentId('00000000-0000-4000-8000-000000000201')
const MISSING = documentId('00000000-0000-4000-8000-0000000002ff')

let uow: InMemoryUnitOfWork
let deps: AppDependencies

const request = (actor: typeof USER | null): FastifyRequest =>
  (actor === null ? {} : { session: { sessionId: 'session-1', userId: actor } }) as FastifyRequest

async function statusOf(run: () => Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await run()
  } catch (error) {
    if (error instanceof AppError) return { status: error.statusCode, code: error.code }
  }
  throw new Error('expected the call to be refused')
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  deps = { uow } as unknown as AppDependencies

  await uow.repos.users.create({ id: USER, email: 'a@example.com', displayName: 'A', now: NOW })
  await uow.repos.users.create({ id: ADMIN, email: 'b@example.com', displayName: 'B', now: NOW })
  await uow.repos.users.setInstanceAdmin(ADMIN, true)
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
  await uow.repos.documents.create({
    id: DOC,
    shortId: aShortId(),
    workspaceId: WORKSPACE,
    collectionId: 'gone',
    parentId: null,
    slug: 'orphan',
    path: 'architecture/orphan.md',
    title: 'Orphan',
    status: 'draft',
    templateId: null,
    templateVersion: null,
    now: NOW,
  })
})

describe('requestPrincipal', () => {
  it('is the signed-in user, or nobody at all', () => {
    expect(requestPrincipal(request(USER))).toEqual({ userId: USER, shareLinkId: null })
    expect(requestPrincipal(request(null))).toEqual({ userId: null, shareLinkId: null })
  })
})

describe('requireDocumentAccess', () => {
  it('reports a document it cannot find as not found', async () => {
    expect(
      await statusOf(() =>
        requireDocumentAccess(authorizerFor(deps, request(USER)), MISSING, 'view'),
      ),
    ).toEqual({ status: 404, code: 'not_found' })
  })

  it('reports a tenancy tree that contradicts itself as a server fault', async () => {
    expect(
      await statusOf(() => requireDocumentAccess(authorizerFor(deps, request(USER)), DOC, 'view')),
    ).toEqual({ status: 500, code: 'broken_tenancy_tree' })

    await uow.repos.documents.update(DOC, { collectionId: null }, NOW)
    expect(
      await statusOf(() => requireDocumentAccess(authorizerFor(deps, request(USER)), DOC, 'view')),
    ).toEqual({ status: 500, code: 'broken_tenancy_tree' })

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
      await statusOf(() =>
        requireWorkspaceAccess(authorizerFor(deps, request(USER)), looping, 'view'),
      ),
    ).toEqual({ status: 500, code: 'broken_tenancy_tree' })
  })

  it('refuses a capability the request does not hold', async () => {
    expect(
      await statusOf(() =>
        requireWorkspaceAccess(authorizerFor(deps, request(USER)), WORKSPACE, 'edit'),
      ),
    ).toEqual({ status: 403, code: 'forbidden' })
  })

  it('reports a workspace it cannot find', async () => {
    expect(
      await statusOf(() =>
        requireWorkspaceAccess(
          authorizerFor(deps, request(USER)),
          workspaceId('00000000-0000-4000-8000-0000000001ff'),
          'view',
        ),
      ),
    ).toEqual({ status: 404, code: 'not_found' })
  })
})

describe('requireInstanceAdmin', () => {
  it('lets an instance admin through and refuses everyone else', async () => {
    await expect(requireInstanceAdmin(deps, request(ADMIN))).resolves.toBeUndefined()
    expect(await statusOf(() => requireInstanceAdmin(deps, request(USER)))).toEqual({
      status: 403,
      code: 'forbidden',
    })
    expect(await statusOf(() => requireInstanceAdmin(deps, request(null)))).toEqual({
      status: 403,
      code: 'forbidden',
    })
  })
})
