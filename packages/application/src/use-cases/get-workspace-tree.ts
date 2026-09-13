import type {
  DocumentId,
  DocumentStatus,
  Principal,
  ScopeChainFailure,
  ShortId,
  WorkspaceId,
} from '@quill/domain'

import type { CollectionId, DocumentRow, UnitOfWork } from '../ports/persistence.ts'
import { visibleDocumentIds } from './list-visible-documents.ts'

/**
 * The navigation tree of a workspace: its collections, and the documents
 * nested inside each one.
 *
 * Which documents a reader may see is answered for the whole workspace in one
 * pass by `visibleDocumentIds`, rather than by resolving each document in turn
 * — a list view cannot afford one chain walk per row (ADR-012) — and it is the
 * same pass the flat document list uses, so the two can never show different
 * things. An instance admin skips it entirely.
 */

export interface WorkspaceTreeDependencies {
  readonly uow: UnitOfWork
}

export interface GetWorkspaceTreeCommand {
  readonly workspaceId: WorkspaceId
  readonly identities: readonly Principal[]
  readonly seesEverything: boolean
}

export interface TreeNode {
  readonly id: DocumentId
  /** The document's short public handle, so a navigation entry can link to it (ADR-035). */
  readonly shortId: ShortId
  readonly title: string
  /** The stored path segment; the words in a URL are derived from the title at read time. */
  readonly slug: string
  readonly status: DocumentStatus
  readonly children: readonly TreeNode[]
}

export interface CollectionTree {
  readonly id: CollectionId
  readonly name: string
  readonly slug: string
  readonly documents: readonly TreeNode[]
}

export type GetWorkspaceTreeResult =
  | { readonly kind: 'tree'; readonly collections: readonly CollectionTree[] }
  | { readonly kind: 'workspace-not-found'; readonly workspaceId: WorkspaceId }
  | { readonly kind: 'broken-tree'; readonly failure: ScopeChainFailure }

export async function getWorkspaceTree(
  deps: WorkspaceTreeDependencies,
  command: GetWorkspaceTreeCommand,
): Promise<GetWorkspaceTreeResult> {
  const { repos } = deps.uow
  const workspace = await repos.workspaces.findById(command.workspaceId)
  if (workspace === null) {
    return { kind: 'workspace-not-found', workspaceId: command.workspaceId }
  }

  const [collections, documents] = await Promise.all([
    repos.collections.listByWorkspace(command.workspaceId),
    repos.documents.listByWorkspace(command.workspaceId),
  ])
  const byCollection = Map.groupBy(documents, (document) => document.collectionId)

  const visible = command.seesEverything
    ? null
    : await visibleDocumentIds(deps, {
        workspace,
        collections,
        byCollection,
        identities: command.identities,
      })
  if (visible !== null && !visible.ok) return { kind: 'broken-tree', failure: visible.failure }

  return {
    kind: 'tree',
    collections: collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      slug: collection.slug,
      documents: nest(
        (byCollection.get(collection.id) ?? []).filter(
          (document) => visible === null || visible.ids.has(document.id),
        ),
      ),
    })),
  }
}

/**
 * The documents in a collection as a tree.
 *
 * Children are grouped once and read from that grouping, so building the tree
 * costs one pass over the documents rather than one scan per parent. A
 * document whose parent the reader cannot see is lifted to the top of its
 * collection rather than disappearing with it: it is the reader's document,
 * and its own grant said so.
 */
function nest(documents: readonly DocumentRow[]): readonly TreeNode[] {
  const byParent = Map.groupBy(documents, (document) => document.parentId)
  const present = new Set(documents.map((document) => document.id))

  const build = (rows: readonly DocumentRow[]): readonly TreeNode[] =>
    rows.map((row) => ({
      id: row.id,
      shortId: row.shortId,
      title: row.title,
      slug: row.slug,
      status: row.status,
      children: build(byParent.get(row.id) ?? []),
    }))

  const roots = documents.filter(
    (document) => document.parentId === null || !present.has(document.parentId),
  )
  return build(roots)
}
