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
  requireSharedDocument,
  requireWorkspaceAccess,
  requestPrincipal,
  SHARE_REFUSAL,
} from './authorization.ts'
import type { SharedAccessLog } from './authorization.ts'

/**
 * How a route asks what a request may do, and what it answers when the
 * tenancy tree cannot place the document at all.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const USER = userId('00000000-0000-4000-8000-000000000001')
const ADMIN = userId('00000000-0000-4000-8000-0000000000ad')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const DOC = documentId('00000000-0000-4000-8000-000000000201')
/** Properly placed, and granted to nobody: the shape a share link must refuse. */
const PLACED = documentId('00000000-0000-4000-8000-000000000202')
/** Filed in no collection, so it has no scope chain at all (ADR-012). */
const NO_COLLECTION = documentId('00000000-0000-4000-8000-000000000203')
/** Nested under a document in another collection, which the chain refuses. */
const PARENT_ELSEWHERE = documentId('00000000-0000-4000-8000-000000000204')
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
  await uow.repos.collections.create({
    id: 'architecture',
    workspaceId: WORKSPACE,
    name: 'Architecture',
    slug: 'architecture',
    now: NOW,
  })
  await uow.repos.documents.create({
    id: PLACED,
    shortId: aShortId(2),
    workspaceId: WORKSPACE,
    collectionId: 'architecture',
    parentId: null,
    slug: 'placed',
    path: 'architecture/placed.md',
    title: 'Placed',
    status: 'published',
    templateId: null,
    templateVersion: null,
    now: NOW,
  })
  await uow.repos.collections.create({
    id: 'runbooks',
    workspaceId: WORKSPACE,
    name: 'Runbooks',
    slug: 'runbooks',
    now: NOW,
  })
  await uow.repos.documents.create({
    id: NO_COLLECTION,
    shortId: aShortId(3),
    workspaceId: WORKSPACE,
    collectionId: null,
    parentId: null,
    slug: 'unfiled',
    path: 'unfiled.md',
    title: 'Unfiled',
    status: 'published',
    templateId: null,
    templateVersion: null,
    now: NOW,
  })
  await uow.repos.documents.create({
    id: PARENT_ELSEWHERE,
    shortId: aShortId(4),
    workspaceId: WORKSPACE,
    collectionId: 'runbooks',
    parentId: PLACED,
    slug: 'across-a-boundary',
    path: 'runbooks/across-a-boundary.md',
    title: 'Across a boundary',
    status: 'published',
    templateId: null,
    templateVersion: null,
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
    expect(requestPrincipal(request(USER))).toEqual({ userId: USER, shareLinkToken: null })
    expect(requestPrincipal(request(null))).toEqual({ userId: null, shareLinkToken: null })
  })

  it('carries the share-link token a request presented, whoever is signed in', () => {
    expect(requestPrincipal(request(USER), 'secret')).toEqual({
      userId: USER,
      shareLinkToken: 'secret',
    })
    expect(requestPrincipal(request(null), 'secret')).toEqual({
      userId: null,
      shareLinkToken: 'secret',
    })
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

/**
 * The share surface answers one thing, however it is refused: a reader
 * holding a link must not be able to tell a document outside its scope from a
 * document that does not exist (ADR-011, `docs/product/surfaces.md`).
 */
describe('requireSharedDocument', () => {
  let logged: { details: object; message: string }[]

  const log = (): SharedAccessLog => ({
    error: (details, message) => void logged.push({ details, message }),
  })

  const anonymous = (): ReturnType<typeof authorizerFor> => authorizerFor(deps, request(null))

  const refusalOf = async (
    target: typeof DOC,
    capability?: 'view' | 'edit',
  ): Promise<{ status: number; code: string; message: string }> => {
    try {
      await requireSharedDocument(anonymous(), target, log(), capability)
    } catch (error) {
      if (error instanceof AppError) {
        return { status: error.statusCode, code: error.code, message: error.message }
      }
    }
    throw new Error('expected the call to be refused')
  }

  beforeEach(() => {
    logged = []
  })

  it('answers every failure with one refusal, byte for byte', async () => {
    const missing = await refusalOf(MISSING)
    expect(missing).toEqual({ status: 404, code: 'not_found', message: SHARE_REFUSAL })

    // A document the link does not reach; one filed in no collection at all;
    // one whose parent is in another collection; and one the reader may see
    // but not edit. The first two of those are `broken-tree` and
    // `document-without-collection` inside the authorizer, which
    // `toAppError` would answer as a `500` carrying `details` — telling an
    // anonymous holder both that the document exists and how it is filed.
    for (const refusal of [
      await refusalOf(PLACED),
      await refusalOf(NO_COLLECTION),
      await refusalOf(PARENT_ELSEWHERE),
      await refusalOf(PLACED, 'edit'),
    ]) {
      expect(refusal).toEqual(missing)
    }
  })

  it('writes the platform’s own faults to the log, and an ordinary miss to nobody', async () => {
    await refusalOf(NO_COLLECTION)
    await refusalOf(PARENT_ELSEWHERE)
    expect(
      logged.map((entry) => (entry.details as { failure: { kind: string } }).failure.kind),
    ).toEqual(['document-without-collection', 'broken-tree'])

    // A document that is not there, and a capability the reader lacks, are
    // the ordinary answers on a surface whose job is to refuse — and anybody
    // holding a link can ask for either, so logging them at `error` would
    // hand them the log along with the 404.
    logged = []
    await refusalOf(MISSING)
    await refusalOf(PLACED, 'edit')
    expect(logged).toEqual([])
  })
})
