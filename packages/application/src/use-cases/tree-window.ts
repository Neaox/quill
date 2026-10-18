import type { DocumentId } from '@quill/domain'

import type { CollectionId } from '../ports/persistence.ts'
import type { CollectionTree, TreeNode } from './get-workspace-tree.ts'

/**
 * The navigation tree cut down to what a sidebar draws.
 *
 * A workspace can hold tens of thousands of documents, and the whole tree is
 * megabytes of JSON that a reader mostly never unfolds. These cut a tree that
 * `getWorkspaceTree` has already filtered for the reader — so a page of it can
 * never show what the whole would have hidden — into a few levels, one page
 * of each list, and the way down to the document being read; the rest is
 * fetched a page at a time as the reader opens it (`childrenPage`).
 *
 * Every node says how many children it has in all and where its page starts,
 * so the sidebar can draw "Show more" without having seen the rest.
 */

export interface WindowedNode extends Omit<TreeNode, 'children'> {
  /** One page of the node's children, or none when they were not asked for. */
  readonly children: readonly WindowedNode[]
  /** How many children the node has in all. */
  readonly childCount: number
  /** Where `children` starts among them. */
  readonly childrenOffset: number
}

export interface WindowedCollection extends Omit<CollectionTree, 'documents'> {
  readonly documents: readonly WindowedNode[]
  /** How many documents the collection has at its top level. */
  readonly documentCount: number
  /** Where `documents` starts among them. */
  readonly documentsOffset: number
  /** Every document in the collection the reader can see, nesting included. */
  readonly total: number
}

export interface TreeWindowOptions {
  /**
   * How many levels to include below each collection, from 1. Omitted, every
   * level: the whole tree, as it has always been answered.
   */
  readonly depth?: number | undefined
  /** How many entries of any one list to include. */
  readonly limit: number
  /** A document whose ancestors, siblings' page and own children are included at any depth. */
  readonly focus?: DocumentId | undefined
}

/** Every node in a list, nesting included. */
function countAll(nodes: readonly TreeNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countAll(node.children), 0)
}

/** The focused document's ancestors and itself, by id, each with its index among its siblings. */
function pathTo(nodes: readonly TreeNode[], focus: DocumentId): ReadonlyMap<DocumentId, number> {
  for (const [index, node] of nodes.entries()) {
    if (node.id === focus) return new Map([[node.id, index]])
    const below = pathTo(node.children, focus)
    if (below.size > 0) return new Map([[node.id, index], ...below])
  }
  return new Map()
}

/** Where a page starts: the first, unless the path goes through a later one. */
function pageStart(position: number | undefined, limit: number): number {
  if (position === undefined || !Number.isFinite(limit) || position < limit) return 0
  return position - (position % limit)
}

function windowNodes(
  nodes: readonly TreeNode[],
  levels: number,
  options: TreeWindowOptions,
  path: ReadonlyMap<DocumentId, number>,
): { readonly nodes: readonly WindowedNode[]; readonly offset: number } {
  const position = nodes.find((node) => path.has(node.id))
  const offset = pageStart(
    position === undefined ? undefined : path.get(position.id),
    options.limit,
  )
  const page = nodes.slice(offset, offset + options.limit)
  return {
    offset,
    nodes: page.map((node) => {
      const open = levels > 1 || path.has(node.id)
      const children = open
        ? windowNodes(node.children, levels - 1, options, path)
        : { nodes: [], offset: 0 }
      return {
        id: node.id,
        shortId: node.shortId,
        title: node.title,
        slug: node.slug,
        status: node.status,
        children: children.nodes,
        childCount: node.children.length,
        childrenOffset: children.offset,
      }
    }),
  }
}

export function windowTree(
  collections: readonly CollectionTree[],
  options: TreeWindowOptions,
): readonly WindowedCollection[] {
  const levels = options.depth ?? Number.POSITIVE_INFINITY
  return collections.map((collection) => {
    const path =
      options.focus === undefined ? new Map() : pathTo(collection.documents, options.focus)
    const top = windowNodes(collection.documents, levels, options, path)
    return {
      id: collection.id,
      name: collection.name,
      slug: collection.slug,
      documents: top.nodes,
      documentCount: collection.documents.length,
      documentsOffset: top.offset,
      total: countAll(collection.documents),
    }
  })
}

/** Whose children: a collection's top level, or a document's. */
export type ChildrenOwner =
  | { readonly kind: 'collection'; readonly collectionId: CollectionId }
  | { readonly kind: 'document'; readonly parentId: DocumentId }

export type ChildrenPageResult =
  | {
      readonly kind: 'page'
      readonly documents: readonly WindowedNode[]
      readonly total: number
      readonly offset: number
    }
  | { readonly kind: 'not-found' }

function findNode(nodes: readonly TreeNode[], id: DocumentId): TreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const below = findNode(node.children, id)
    if (below !== undefined) return below
  }
  return undefined
}

/**
 * One page of a list in the tree, each entry with its count and none of its
 * children. A parent the reader cannot see is not found, exactly as it would
 * be missing from their whole tree.
 */
export function childrenPage(
  collections: readonly CollectionTree[],
  owner: ChildrenOwner,
  page: { readonly offset: number; readonly limit: number },
): ChildrenPageResult {
  const list =
    owner.kind === 'collection'
      ? collections.find((collection) => collection.id === owner.collectionId)?.documents
      : collections
          .map((collection) => findNode(collection.documents, owner.parentId))
          .find((found) => found !== undefined)?.children
  if (list === undefined) return { kind: 'not-found' }
  const offset = Math.min(Math.max(0, page.offset), list.length)
  return {
    kind: 'page',
    total: list.length,
    offset,
    documents: windowNodes(list.slice(offset, offset + page.limit), 1, page, new Map()).nodes,
  }
}
