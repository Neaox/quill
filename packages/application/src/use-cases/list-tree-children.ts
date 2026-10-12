import type {
  DocumentId,
  DocumentStatus,
  Principal,
  ScopeChainFailure,
  ShortId,
  WorkspaceId,
} from '@quill/domain'

import type { ChildCursor, CollectionId, DocumentRow, UnitOfWork } from '../ports/persistence.ts'
import { visibleDocumentIds } from './list-visible-documents.ts'

/**
 * One page of the documents directly under a parent, for a navigation tree that opens a
 * level at a time (ADR-049): what the reader may see, in the order siblings have, each with
 * how many documents it has beneath it so a row knows whether it can be opened.
 *
 * Nothing in the answer grows with the size of the workspace, only with the page. Which
 * documents a reader may see is still answered for the whole workspace at once
 * (`visibleDocumentIds`, the pass the flat list uses, so the two agree); an instance
 * administrator skips it and is answered from the index alone.
 */

export interface ListTreeChildrenDependencies {
  readonly uow: UnitOfWork
}

export interface ListTreeChildrenCommand {
  readonly workspaceId: WorkspaceId
  readonly collectionId: CollectionId
  /** The parent; null for the documents at the top of the collection. */
  readonly parentId: DocumentId | null
  readonly after: ChildCursor | null
  readonly limit: number
  readonly identities: readonly Principal[]
  readonly seesEverything: boolean
}

export interface TreeChild {
  readonly id: DocumentId
  readonly shortId: ShortId
  readonly title: string
  readonly slug: string
  readonly status: DocumentStatus
  /** How many documents it has directly beneath it, that the reader may see. */
  readonly childCount: number
}

export type ListTreeChildrenResult =
  | {
      readonly kind: 'children'
      readonly nodes: readonly TreeChild[]
      /** Where the next page resumes; null when this was the last. */
      readonly next: ChildCursor | null
    }
  | { readonly kind: 'workspace-not-found'; readonly workspaceId: WorkspaceId }
  | { readonly kind: 'collection-not-found'; readonly collectionId: CollectionId }
  | { readonly kind: 'broken-tree'; readonly failure: ScopeChainFailure }

/** How many rows a page asks the index for, relative to the page, when some may be hidden. */
const OVERFETCH = 2

/** Where a page resumes after its last row; null for an empty page, which has nowhere to resume. */
function resumeAfter(rows: readonly DocumentRow[]): ChildCursor | null {
  const last = rows.at(-1)
  return last === undefined ? null : { createdAt: last.createdAt, id: last.id }
}

export async function listTreeChildren(
  deps: ListTreeChildrenDependencies,
  command: ListTreeChildrenCommand,
): Promise<ListTreeChildrenResult> {
  const { repos } = deps.uow
  const workspace = await repos.workspaces.findById(command.workspaceId)
  if (workspace === null) return { kind: 'workspace-not-found', workspaceId: command.workspaceId }
  const collections = await repos.collections.listByWorkspace(command.workspaceId)
  if (!collections.some(({ id }) => id === command.collectionId)) {
    return { kind: 'collection-not-found', collectionId: command.collectionId }
  }

  const pageOf = (after: ChildCursor | null, limit: number) =>
    repos.documents.listChildren({
      workspaceId: command.workspaceId,
      collectionId: command.collectionId,
      parentId: command.parentId,
      after,
      limit,
    })

  if (command.seesEverything) {
    const rows = await pageOf(command.after, command.limit + 1)
    const page = rows.slice(0, command.limit)
    const counts = await repos.documents.countChildren(page.map(({ id }) => id))
    return {
      kind: 'children',
      nodes: page.map((row) => toChild(row, counts.get(row.id) ?? 0)),
      next: rows.length > command.limit ? resumeAfter(page) : null,
    }
  }

  const documents = await repos.documents.listByWorkspace(command.workspaceId)
  const visible = await visibleDocumentIds(deps, {
    workspace,
    collections,
    byCollection: Map.groupBy(documents, (document) => document.collectionId),
    identities: command.identities,
  })
  if (!visible.ok) return { kind: 'broken-tree', failure: visible.failure }

  // Hidden documents are skipped, not counted: a page is as many as the reader can see.
  const seen: DocumentRow[] = []
  let after = command.after
  let exhausted = false
  while (seen.length <= command.limit && !exhausted) {
    const batch = await pageOf(after, command.limit * OVERFETCH + 1)
    exhausted = batch.length < command.limit * OVERFETCH + 1
    seen.push(...batch.filter(({ id }) => visible.ids.has(id)))
    after = resumeAfter(batch)
    if (after === null) break
  }

  const page = seen.slice(0, command.limit)
  const counts = Map.groupBy(
    documents.filter(({ id, parentId }) => parentId !== null && visible.ids.has(id)),
    ({ parentId }) => parentId,
  )
  return {
    kind: 'children',
    nodes: page.map((row) => toChild(row, counts.get(row.id)?.length ?? 0)),
    next: seen.length > command.limit ? resumeAfter(page) : null,
  }
}

function toChild(row: DocumentRow, childCount: number): TreeChild {
  return {
    id: row.id,
    shortId: row.shortId,
    title: row.title,
    slug: row.slug,
    status: row.status,
    childCount,
  }
}
