import type { UserId, WorkspaceId } from '@quill/domain'

import type { Clock, IdGenerator } from '../ports/system.ts'
import type { CollectionId, CollectionRow, UnitOfWork } from '../ports/persistence.ts'
import { namedSlug } from './document-path.ts'

/**
 * Collections: the first-level containers in a workspace, and a permission
 * scope of their own rather than ordinary folders (ADR-012).
 *
 * Three commands and a list. Each is a use case rather than a repository call
 * from a route (AGENTS.md rule 3), which is also what gives them an audit
 * row: creating, renaming and deleting a container of documentation is
 * administration, and ADR-011 asks for administrative actions to be audited.
 *
 * Two rules are worth stating out loud.
 *
 * **A rename never moves the slug.** Documents are addressed by id (rule 8),
 * so a collection's slug is not part of anything's address and does not need
 * to follow its name; leaving it alone means a rename cannot break a link,
 * a bookmark, or a published path.
 *
 * **A collection that still holds documents is not deleted.** `collection_id`
 * is nullable and deleting the row would set it null, which takes every one
 * of those documents *out of the permission tree* — a document in no
 * collection has no scope chain and cannot be resolved at all (ADR-012). The
 * caller moves or deletes the documents first.
 */

export const COLLECTION_AUDIT_EVENTS = {
  created: 'collection.created',
  renamed: 'collection.renamed',
  deleted: 'collection.deleted',
} as const

export interface CollectionDependencies {
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface CreateCollectionCommand {
  readonly workspaceId: WorkspaceId
  readonly name: string
  readonly createdBy: UserId
}

export type CreateCollectionResult =
  | { readonly kind: 'created'; readonly collection: CollectionRow }
  /** Another collection in this workspace already has the slug this name derives. */
  | { readonly kind: 'slug-taken'; readonly slug: string }

export async function createCollection(
  deps: CollectionDependencies,
  command: CreateCollectionCommand,
): Promise<CreateCollectionResult> {
  const { repos } = deps.uow
  const slug = namedSlug(command.name)
  const existing = await repos.collections.findBySlug(command.workspaceId, slug)
  if (existing !== null) return { kind: 'slug-taken', slug }

  const now = deps.clock.now()
  const collection = await repos.collections.create({
    id: deps.ids.uuid(),
    workspaceId: command.workspaceId,
    name: command.name,
    slug,
    now,
  })
  await audit(deps, {
    type: COLLECTION_AUDIT_EVENTS.created,
    actorUserId: command.createdBy,
    targetId: collection.id,
    metadata: { workspaceId: command.workspaceId, name: collection.name, slug },
  })
  return { kind: 'created', collection }
}

export interface RenameCollectionCommand {
  readonly collectionId: CollectionId
  readonly name: string
  readonly renamedBy: UserId
}

export type RenameCollectionResult =
  | { readonly kind: 'renamed'; readonly collection: CollectionRow }
  | { readonly kind: 'not-found' }

export async function renameCollection(
  deps: CollectionDependencies,
  command: RenameCollectionCommand,
): Promise<RenameCollectionResult> {
  const { repos } = deps.uow
  const existing = await repos.collections.findById(command.collectionId)
  if (existing === null) return { kind: 'not-found' }

  const collection = await repos.collections.rename(command.collectionId, command.name)
  await audit(deps, {
    type: COLLECTION_AUDIT_EVENTS.renamed,
    actorUserId: command.renamedBy,
    targetId: collection.id,
    // The slug stays put, which is the part a reader will want to confirm.
    metadata: { from: existing.name, to: collection.name, slug: collection.slug },
  })
  return { kind: 'renamed', collection }
}

export interface DeleteCollectionCommand {
  readonly collectionId: CollectionId
  readonly deletedBy: UserId
}

export type DeleteCollectionResult =
  | { readonly kind: 'deleted' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'not-empty'; readonly documents: number }

export async function deleteCollection(
  deps: CollectionDependencies,
  command: DeleteCollectionCommand,
): Promise<DeleteCollectionResult> {
  const { repos } = deps.uow
  const existing = await repos.collections.findById(command.collectionId)
  if (existing === null) return { kind: 'not-found' }

  const documents = await repos.collections.countDocuments(command.collectionId)
  if (documents > 0) return { kind: 'not-empty', documents }

  await repos.collections.delete(command.collectionId)
  await audit(deps, {
    type: COLLECTION_AUDIT_EVENTS.deleted,
    actorUserId: command.deletedBy,
    targetId: existing.id,
    metadata: { workspaceId: existing.workspaceId, name: existing.name, slug: existing.slug },
  })
  return { kind: 'deleted' }
}

export interface ListCollectionsCommand {
  readonly workspaceId: WorkspaceId
}

/** By name, because that is how a picker shows them. */
export async function listCollections(
  deps: CollectionDependencies,
  command: ListCollectionsCommand,
): Promise<readonly CollectionRow[]> {
  return deps.uow.repos.collections.listByWorkspace(command.workspaceId)
}

async function audit(
  deps: CollectionDependencies,
  event: {
    readonly type: string
    readonly actorUserId: UserId
    readonly targetId: string
    readonly metadata: Readonly<Record<string, unknown>>
  },
): Promise<void> {
  await deps.uow.repos.audit.write({
    id: deps.ids.uuid(),
    type: event.type,
    actorUserId: event.actorUserId,
    targetType: 'collection',
    targetId: event.targetId,
    metadata: event.metadata,
    now: deps.clock.now(),
  })
}
