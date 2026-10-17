import { PUBLIC_PRINCIPAL } from '@quill/domain'
import type { DocumentId, Principal, ScopeChainFailure } from '@quill/domain'

import type {
  CollectionRow,
  DocumentRow,
  DocumentSummaryRow,
  UnitOfWork,
  WorkspaceRow,
} from '../ports/persistence.ts'
import { visibleDocumentIds } from './list-visible-documents.ts'

/**
 * The pages under a document, for a child pages list (ADR-056).
 *
 * The list is a slot filled as a page is assembled (ADR-032), because it
 * depends on other documents and on who is reading. Answering it costs a
 * fixed number of queries however many pages there are, never one per page:
 *
 * - **The subtree**, in one recursive query bounded by the depth, with the
 *   document's own ancestors beside it (their grants are inherited by every
 *   page under them), and the summaries of every page in one more. These
 *   three describe the tree and nothing about the reader, so they are what a
 *   `ChildPagesCache` keeps, keyed by the parent and the depth, until an
 *   outbox event says something in or under it changed.
 * - **Visibility**, answered per request by the same materialise-and-combine
 *   pass the navigation tree and the public site use (ADR-012), over this one
 *   collection: a document's children are always in its collection. It is
 *   never cached, so a new deny takes effect at once.
 *
 * A child the reader cannot read is never listed, and neither is anything
 * under it: unlike the navigation tree, which lifts such a page to the top so
 * the reader does not lose it, this list is about *this* page's children, and
 * a grandchild is not one. On the public site only published pages exist.
 */

export type ChildPagesSort = 'manual' | 'title' | 'updated'

export interface ChildPagesOptions {
  /** How many levels below the parent, from 1. */
  readonly depth: number
  readonly sort: ChildPagesSort
}

/** Who the list is for: a request with its principals, or the anonymous public site. */
export type ChildPagesAudience =
  | {
      readonly kind: 'reader'
      readonly identities: readonly Principal[]
      /** An instance administrator, who sees everything (ADR-012). */
      readonly seesEverything: boolean
    }
  | { readonly kind: 'public' }

export interface ChildPageNode {
  readonly document: DocumentRow
  readonly summary: string | null
  readonly icon: string | null
  readonly children: readonly ChildPageNode[]
}

/** What describes a subtree, whoever reads it: what a cache may keep. */
export interface ChildPagesStructure {
  readonly collection: CollectionRow | null
  /** The parent and every document above it, nearest first. */
  readonly ancestors: readonly DocumentRow[]
  /** Every document under the parent, to the depth asked for. */
  readonly descendants: readonly DocumentRow[]
  readonly summaries: ReadonlyMap<DocumentId, DocumentSummaryRow>
}

/**
 * Keeps subtrees between requests (the cache pattern of
 * `docs/architecture/patterns.md`). The server's implementation is bounded by
 * size and time and is invalidated by outbox events; without one, every
 * request reads the subtree afresh.
 */
export interface ChildPagesCache {
  find(key: string): ChildPagesStructure | undefined
  remember(key: string, structure: ChildPagesStructure): void
}

export interface ChildPagesDependencies {
  readonly uow: UnitOfWork
  readonly childPagesCache?: ChildPagesCache | undefined
}

export interface ListChildPagesCommand {
  /** The document whose children are listed; the caller has already checked it may be read. */
  readonly parent: DocumentRow
  readonly workspace: WorkspaceRow
  readonly options: ChildPagesOptions
  readonly audience: ChildPagesAudience
}

export type ListChildPagesResult =
  | { readonly kind: 'pages'; readonly pages: readonly ChildPageNode[] }
  | { readonly kind: 'broken-tree'; readonly failure: ScopeChainFailure }

/** The deepest a list may reach (ADR-056). */
export const MAX_CHILD_PAGES_DEPTH = 6

/** The cache key of a subtree: the parent and the depth, which are all that decide its rows. */
export function childPagesKey(parent: DocumentId, depth: number): string {
  return `${parent}\n${String(depth)}`
}

export async function listChildPages(
  deps: ChildPagesDependencies,
  command: ListChildPagesCommand,
): Promise<ListChildPagesResult> {
  const depth = Math.min(Math.max(Math.trunc(command.options.depth), 1), MAX_CHILD_PAGES_DEPTH)
  const structure = await subtree(deps, command.parent, depth)
  const visible = await readable(deps, command, structure)
  if (!visible.ok) return { kind: 'broken-tree', failure: visible.failure }

  const byParent = Map.groupBy(
    structure.descendants.filter((row) => visible.allows(row)),
    (row) => row.parentId,
  )
  const compare = ORDER[command.options.sort]
  const build = (parentId: DocumentId): readonly ChildPageNode[] =>
    (byParent.get(parentId) ?? []).toSorted(compare).map((document) => {
      const summary = structure.summaries.get(document.id)
      return {
        document,
        summary: summary?.summary ?? null,
        icon: summary?.icon ?? null,
        children: build(document.id),
      }
    })
  return { kind: 'pages', pages: build(command.parent.id) }
}

async function subtree(
  deps: ChildPagesDependencies,
  parent: DocumentRow,
  depth: number,
): Promise<ChildPagesStructure> {
  const key = childPagesKey(parent.id, depth)
  const cached = deps.childPagesCache?.find(key)
  if (cached !== undefined) return cached

  const { repos } = deps.uow
  const [descendants, ancestors, collection] = await Promise.all([
    repos.documents.listDescendants(parent.id, depth),
    repos.documents.listAncestors(parent.id),
    parent.collectionId === null ? null : repos.collections.findById(parent.collectionId),
  ])
  const summaries = await repos.documentSummaries.listByIds(descendants.map((row) => row.id))
  const structure: ChildPagesStructure = {
    collection,
    ancestors,
    descendants,
    summaries: new Map(summaries.map((row) => [row.documentId, row])),
  }
  deps.childPagesCache?.remember(key, structure)
  return structure
}

type Readable =
  | { readonly ok: true; allows(row: DocumentRow): boolean }
  | { readonly ok: false; readonly failure: ScopeChainFailure }

async function readable(
  deps: ChildPagesDependencies,
  command: ListChildPagesCommand,
  structure: ChildPagesStructure,
): Promise<Readable> {
  const { audience } = command
  const published = audience.kind === 'public'
  if (audience.kind === 'reader' && audience.seesEverything) return { ok: true, allows: () => true }
  // A document filed in no collection has no place in the permission tree,
  // and nothing under it can be shown to anyone but an administrator.
  if (structure.collection === null) return { ok: true, allows: () => false }

  const visible = await visibleDocumentIds(deps, {
    workspace: command.workspace,
    collections: [structure.collection],
    byCollection: new Map([
      [structure.collection.id, [...structure.ancestors, ...structure.descendants]],
    ]),
    identities: audience.kind === 'public' ? [PUBLIC_PRINCIPAL] : audience.identities,
  })
  if (!visible.ok) return visible
  return {
    ok: true,
    allows: (row) => visible.ids.has(row.id) && (!published || row.headRevision !== null),
  }
}

/** Created first: the navigation's order until manual ordering lands (ADR-056). */
const manual = (left: DocumentRow, right: DocumentRow): number =>
  left.createdAt.getTime() - right.createdAt.getTime() || (left.id < right.id ? -1 : 1)

const ORDER: Readonly<Record<ChildPagesSort, (left: DocumentRow, right: DocumentRow) => number>> = {
  manual,
  title: (left, right) => left.title.localeCompare(right.title) || manual(left, right),
  updated: (left, right) =>
    right.updatedAt.getTime() - left.updatedAt.getTime() || manual(left, right),
}
