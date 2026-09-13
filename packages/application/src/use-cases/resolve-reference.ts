import type { WorkspaceId } from '@quill/domain'
import { isUuid } from '@quill/domain'

import type {
  DocumentRepository,
  DocumentRow,
  UnitOfWork,
  WorkspaceRow,
} from '../ports/persistence.ts'
import type { Clock } from '../ports/system.ts'
import { parseDocumentReference } from './document-path.ts'
import type { DocumentReference } from './document-path.ts'

/**
 * Turning the readable halves of a URL back into the things they name
 * (ADR-035).
 *
 * Both resolutions are deliberately forgiving in one direction only: every
 * form the platform has ever put in a link keeps resolving (ADR-033), and the
 * advisory parts — the title slug, the workspace segment — are never consulted
 * and never trusted. The caller is told what matched so that it can correct
 * the address it was given: a document reached by its key carries its own
 * workspace, which may not be the one in the URL at all if the document has
 * been moved since the link was written.
 */

export interface ResolveReferenceDependencies {
  readonly uow: UnitOfWork
  readonly clock: Clock
}

/** How a document reference was matched, and therefore whether the URL was canonical. */
export type DocumentReferenceMatch = 'short-id' | 'uuid'

export type ResolveDocumentReferenceResult =
  | {
      readonly kind: 'resolved'
      readonly document: DocumentRow
      /** The workspace the document actually lives in, whatever the URL said. */
      readonly workspace: WorkspaceRow
      readonly matched: DocumentReferenceMatch
    }
  | { readonly kind: 'not-found'; readonly reference: string }

export interface ResolveDocumentReferenceCommand {
  readonly reference: string
}

export async function resolveDocumentReference(
  deps: ResolveReferenceDependencies,
  command: ResolveDocumentReferenceCommand,
): Promise<ResolveDocumentReferenceResult> {
  const { repos } = deps.uow
  const reference = parseDocumentReference(command.reference)
  if (reference === null) return { kind: 'not-found', reference: command.reference }

  const document = await findByReference(repos.documents, reference)
  if (document === null) {
    return { kind: 'not-found', reference: command.reference }
  }

  const workspace = await repos.workspaces.findById(document.workspaceId)
  /* v8 ignore next 3 -- a document's workspace is a foreign key, so it is always there. */
  if (workspace === null) {
    return { kind: 'not-found', reference: command.reference }
  }

  return { kind: 'resolved', document, workspace, matched: reference.kind }
}

/**
 * The document a reference names, by whichever handle it carries.
 *
 * The key is unique across the instance, so it resolves without a workspace
 * and regardless of which workspace the link named (ADR-035).
 */
async function findByReference(
  documents: DocumentRepository,
  reference: DocumentReference,
): Promise<DocumentRow | null> {
  return reference.kind === 'short-id'
    ? documents.findByShortId(reference.shortId)
    : documents.findById(reference.documentId)
}

/**
 * How long a workspace keeps answering to a slug it has stopped using
 * (ADR-035). A year is long enough for the links in a wiki, a ticket, and a
 * chat archive to be found and updated, and short enough that a slug can
 * eventually be reused.
 */
export const WORKSPACE_SLUG_HISTORY_TTL_MS = 365 * 24 * 60 * 60 * 1000

export type WorkspaceReferenceMatch = 'uuid' | 'slug' | 'retired-slug'

export type ResolveWorkspaceReferenceResult =
  | {
      readonly kind: 'resolved'
      readonly workspace: WorkspaceRow
      readonly matched: WorkspaceReferenceMatch
    }
  | { readonly kind: 'not-found'; readonly reference: string }

export interface ResolveWorkspaceReferenceCommand {
  readonly reference: string
}

/**
 * The workspace an id or a slug names.
 *
 * The id is tried first, because a UUID is unambiguous and must resolve for
 * ever; then the live slug; then the slugs this instance has retired within
 * the last year, which is what keeps a link written before a rename working.
 */
export async function resolveWorkspaceReference(
  deps: ResolveReferenceDependencies,
  command: ResolveWorkspaceReferenceCommand,
): Promise<ResolveWorkspaceReferenceResult> {
  const { repos } = deps.uow
  const reference = command.reference

  if (isUuid(reference)) {
    const byId = await repos.workspaces.findById(reference.toLowerCase() as WorkspaceId)
    if (byId !== null) return { kind: 'resolved', workspace: byId, matched: 'uuid' }
  }

  const bySlug = await repos.workspaces.findBySlug(reference)
  if (bySlug !== null) return { kind: 'resolved', workspace: bySlug, matched: 'slug' }

  const cutoff = new Date(deps.clock.now().getTime() - WORKSPACE_SLUG_HISTORY_TTL_MS)
  const retired = await repos.workspaceSlugHistory.findBySlug(reference, cutoff)
  if (retired === null) return { kind: 'not-found', reference }

  const workspace = await repos.workspaces.findById(retired.workspaceId)
  /* v8 ignore next -- history rows cascade with their workspace, so it is always there. */
  if (workspace === null) return { kind: 'not-found', reference }
  return { kind: 'resolved', workspace, matched: 'retired-slug' }
}
