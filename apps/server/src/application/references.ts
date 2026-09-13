import { isUuid } from '@quill/domain'
import { resolveDocumentReference, resolveWorkspaceReference } from '@quill/application'
import type { DocumentId, WorkspaceId } from '@quill/domain'

import type { AppDependencies } from '../dependencies.ts'
import { notFound } from '../errors.ts'

/**
 * How a route turns the readable half of a URL into the thing it names
 * (ADR-035).
 *
 * Every `/api/documents/:id` route takes a document's UUID or its short key,
 * and every `/api/workspaces/:id` route takes a workspace's UUID or its slug,
 * so a client can pass through whatever its own address bar carries without
 * resolving it first. The canonical form costs nothing: a UUID is handed
 * straight on, because the authorizer loads the row a moment later and
 * answers for a document that is not there. Anything else is resolved by the
 * use case, which is also where the full order lives — a retired workspace
 * slug included.
 */

export async function resolveDocumentId(
  deps: AppDependencies,
  reference: string,
): Promise<DocumentId> {
  if (isUuid(reference)) return reference.toLowerCase() as DocumentId
  const resolved = await resolveDocumentReference(deps, { reference })
  if (resolved.kind !== 'resolved') throw notFound('Document not found')
  return resolved.document.id
}

export async function resolveWorkspaceId(
  deps: AppDependencies,
  reference: string,
): Promise<WorkspaceId> {
  if (isUuid(reference)) return reference.toLowerCase() as WorkspaceId
  const resolved = await resolveWorkspaceReference(deps, { reference })
  if (resolved.kind !== 'resolved') throw notFound('Workspace not found')
  return resolved.workspace.id
}
