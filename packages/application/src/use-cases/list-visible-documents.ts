import { combineContributions, materialiseEffectivePermissions } from '@quill/domain'
import type {
  CollectionNode,
  DocumentId,
  Principal,
  ScopeChainFailure,
  WorkspaceId,
} from '@quill/domain'

import type {
  CollectionId,
  CollectionRow,
  DocumentRow,
  GrantRepository,
  GrantRow,
  UnitOfWork,
  WorkspaceRow,
} from '../ports/persistence.ts'
import { toGrants } from './authorizer.ts'
import {
  toCollectionEntity,
  toDocumentEntity,
  toWorkspaceEntity,
  unitsById,
} from './tenancy-entities.ts'

/**
 * The documents of a workspace a request may actually see.
 *
 * Every list of documents has to answer the same question the authorizer
 * answers for one document, and has to answer it the same way, or a reader
 * learns from a flat list what the navigation tree hides. So the visibility
 * pass lives here once: it materialises the workspace's effective permissions
 * in one walk and combines them with the very function `resolvePermission`
 * ends in (ADR-012). An instance admin skips it entirely.
 */

export interface VisibleDocumentsDependencies {
  readonly uow: UnitOfWork
}

export interface ListVisibleDocumentsCommand {
  readonly workspaceId: WorkspaceId
  readonly identities: readonly Principal[]
  readonly seesEverything: boolean
}

export type ListVisibleDocumentsResult =
  | { readonly kind: 'documents'; readonly documents: readonly DocumentRow[] }
  | { readonly kind: 'workspace-not-found'; readonly workspaceId: WorkspaceId }
  | { readonly kind: 'broken-tree'; readonly failure: ScopeChainFailure }

export async function listVisibleDocuments(
  deps: VisibleDocumentsDependencies,
  command: ListVisibleDocumentsCommand,
): Promise<ListVisibleDocumentsResult> {
  const { repos } = deps.uow
  const workspace = await repos.workspaces.findById(command.workspaceId)
  if (workspace === null) {
    return { kind: 'workspace-not-found', workspaceId: command.workspaceId }
  }

  const documents = await repos.documents.listByWorkspace(command.workspaceId)
  if (command.seesEverything) return { kind: 'documents', documents }

  const visible = await visibleDocumentIds(deps, {
    workspace,
    collections: await repos.collections.listByWorkspace(command.workspaceId),
    byCollection: Map.groupBy(documents, (document) => document.collectionId),
    identities: command.identities,
  })
  if (!visible.ok) return { kind: 'broken-tree', failure: visible.failure }

  return {
    kind: 'documents',
    documents: documents.filter((document) => visible.ids.has(document.id)),
  }
}

export interface VisibilityInput {
  readonly workspace: WorkspaceRow
  readonly collections: readonly CollectionRow[]

  /**
   * The workspace's documents grouped by collection. Grouping once is what
   * keeps a workspace from costing a full scan of its documents per
   * collection; a document filed in no collection has no place in the
   * permission tree and is therefore never visible.
   */
  readonly byCollection: ReadonlyMap<CollectionId | null, readonly DocumentRow[]>
  readonly identities: readonly Principal[]
}

export type VisibilityOutcome =
  | { readonly ok: true; readonly ids: ReadonlySet<DocumentId> }
  | { readonly ok: false; readonly failure: ScopeChainFailure }

/**
 * The ids in one workspace the given principals may view.
 *
 * The materialised rows carry each principal's contribution, denies included,
 * so combining the rows a request holds is the whole decision: a deny on the
 * reader discards the allows a group of theirs inherited, and a grant to the
 * public principal — which every request holds — can only ever widen the
 * answer.
 */
export async function visibleDocumentIds(
  deps: VisibleDocumentsDependencies,
  input: VisibilityInput,
): Promise<VisibilityOutcome> {
  const { repos } = deps.uow
  const units = await repos.units.listAncestors(input.workspace.unitId)

  const nodes = input.collections.map((collection): CollectionNode => ({
    collection: toCollectionEntity(collection),
    documents: (input.byCollection.get(collection.id) ?? []).map((document) =>
      toDocumentEntity(document, collection.id),
    ),
  }))

  const grants = await grantsHeldBy(repos.grants, input.identities)

  const rows = materialiseEffectivePermissions({
    tree: {
      workspace: toWorkspaceEntity(input.workspace),
      unitsById: unitsById(units),
      collections: nodes,
    },
    grants: toGrants(grants),
  })
  if (!rows.ok) return { ok: false, failure: rows.error }

  const ids = new Set<DocumentId>()
  for (const [documentId, contributions] of Map.groupBy(rows.value, (row) => row.documentId)) {
    if (combineContributions(contributions).role !== null) ids.add(documentId)
  }
  return { ok: true, ids }
}

/**
 * Only the grants that can decide this request: the ones its own principals
 * hold, wherever they are attached.
 *
 * Asked by principal rather than by scope, which is the same answer by a far
 * cheaper route. Resolution is per principal (ADR-012), so a grant to somebody
 * else cannot change what this request sees; and
 * `materialiseEffectivePermissions` looks grants up by the scopes it walks, so
 * one attached somewhere else in the instance is never consulted. Asking by
 * scope meant naming every document in the workspace — thousands of selectors,
 * two bound parameters each — to find the handful of grants that a reader
 * actually holds.
 *
 * A request holds a few principals: its user, the groups that user is in, the
 * public principal, and at most one share link. They are asked for
 * concurrently, so the whole step is one round trip deep however many there
 * are.
 */
async function grantsHeldBy(
  grants: GrantRepository,
  identities: readonly Principal[],
): Promise<readonly GrantRow[]> {
  const held = await Promise.all(identities.map((principal) => forPrincipal(grants, principal)))
  return held.flat()
}

function forPrincipal(grants: GrantRepository, principal: Principal): Promise<readonly GrantRow[]> {
  switch (principal.kind) {
    case 'user':
      return grants.listForPrincipal('user', principal.userId)
    case 'group':
      return grants.listForPrincipal('group', principal.groupId)
    case 'share-link':
      // The stored kind spells it with an underscore; the domain's principal
      // spells it with a hyphen.
      return grants.listForPrincipal('share_link', principal.shareLinkId)
    case 'public':
      return grants.listForPrincipal('public', null)
  }
}
