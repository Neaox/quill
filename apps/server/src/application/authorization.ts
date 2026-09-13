import { createAuthorizer } from '@quill/application'
import type {
  AccessFailure,
  Authorizer,
  CollectionAccess,
  CollectionId,
  DocumentAccess,
  RequestPrincipal,
  WorkspaceAccess,
} from '@quill/application'
import type { Capabilities, DocumentId, Result, ShareLinkId, WorkspaceId } from '@quill/domain'
import type { FastifyRequest } from 'fastify'

import type { AppDependencies } from '../dependencies.ts'
import { AppError, forbidden, notFound } from '../errors.ts'

/**
 * How a route asks what the request may do (ADR-012).
 *
 * One authorizer serves one request, so the scope chain, the grants on it, and
 * the identity behind it are loaded once however many checks a handler makes.
 * Routes name the capability they need and never compare roles themselves.
 */

export type Capability = keyof Capabilities

/** A request acts as its signed-in user, or as the public principal. */
export function requestPrincipal(request: FastifyRequest): RequestPrincipal {
  return {
    userId: request.session?.userId ?? null,
    // Share links reach the reading path in M3; the principal already carries
    // them so nothing in resolution has to change when they do.
    shareLinkId: null as ShareLinkId | null,
  }
}

export function authorizerFor(deps: AppDependencies, request: FastifyRequest): Authorizer {
  return createAuthorizer(deps.uow.repos, requestPrincipal(request))
}

/**
 * A tenancy tree that contradicts itself is a server fault, not a client one:
 * the request was well formed and the platform cannot answer it.
 */
function toAppError(failure: AccessFailure): AppError {
  switch (failure.kind) {
    case 'document-not-found':
      return notFound('Document not found')
    case 'workspace-not-found':
      return notFound('Workspace not found')
    case 'collection-not-found':
    case 'document-without-collection':
    case 'broken-tree':
      return new AppError(
        500,
        'broken_tenancy_tree',
        'This document cannot be placed in the tenancy tree',
        failure,
      )
  }
}

function granted<T extends { readonly capabilities: Capabilities }>(
  access: Result<T, AccessFailure>,
  capability: Capability,
): T {
  if (!access.ok) throw toAppError(access.error)
  if (!access.value.capabilities[capability]) {
    throw forbidden(`You do not have permission to ${capability} this`)
  }
  return access.value
}

/** The document, once the request is known to hold the capability it needs. */
export async function requireDocumentAccess(
  authorizer: Authorizer,
  documentId: DocumentId,
  capability: Capability,
): Promise<DocumentAccess> {
  return granted(await authorizer.document(documentId), capability)
}

export async function requireWorkspaceAccess(
  authorizer: Authorizer,
  workspaceId: WorkspaceId,
  capability: Capability,
): Promise<WorkspaceAccess> {
  return granted(await authorizer.workspace(workspaceId), capability)
}

/**
 * A collection is its own permission scope (ADR-012), so moving a document
 * into one asks about the collection rather than about its workspace.
 *
 * A collection id the *caller* supplied and that does not exist is a bad
 * request, not a broken tree: the same failure reached through a document
 * means the document's own collection has gone missing, which is a server
 * fault, so the two are told apart here rather than in `toAppError`.
 */
export async function requireCollectionAccess(
  authorizer: Authorizer,
  collectionId: CollectionId,
  capability: Capability,
): Promise<CollectionAccess> {
  const access = await authorizer.collection(collectionId)
  if (!access.ok && access.error.kind === 'collection-not-found') {
    throw notFound('Collection not found')
  }
  return granted(access, capability)
}

/**
 * Whether the request is made by an instance administrator, without refusing
 * it either way: a list route needs the answer to decide how much to show,
 * where a write route needs it to decide whether to proceed at all.
 */
export async function isInstanceAdmin(
  deps: AppDependencies,
  request: FastifyRequest,
): Promise<boolean> {
  const userId = request.session?.userId
  const user = userId === undefined ? null : await deps.uow.repos.users.findById(userId)
  return user !== null && user.isInstanceAdmin
}

/** Instance administration (units, workspace creation) is not a scoped capability (ADR-012). */
export async function requireInstanceAdmin(
  deps: AppDependencies,
  request: FastifyRequest,
): Promise<void> {
  if (!(await isInstanceAdmin(deps, request))) throw forbidden('Instance admin required')
}
