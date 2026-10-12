import type { TreeNode } from '@quill/ui'

import type { TreeCollectionDto } from '../api/index.ts'
import { documentLink, documentReference } from '../routing/document-reference.ts'

/**
 * The workspace tree as the design system draws it.
 *
 * The server answers with the tree of documents; every surface that shows part
 * of it — the sidebar, the editor's child-documents preview, the reading page's
 * child-documents block — draws the same node: a title, where it is read, and
 * what is beneath it. This is the one place that turns one into the other.
 */

export type ApiTreeNode = TreeCollectionDto['documents'][number]

export function toTreeNode(workspaceSlug: string, node: ApiTreeNode): TreeNode {
  return {
    id: node.id,
    label: node.title,
    // One helper builds every document address (ADR-035): a route and its
    // parameters, so the router encodes the segments and type-checks the
    // pattern, and nothing here concatenates a URL.
    link: documentLink(workspaceSlug, documentReference(node)),
    children: node.children.map((child) => toTreeNode(workspaceSlug, child)),
  }
}

/** The node for a document, wherever in the workspace's collections it is. */
export function findTreeNode(
  collections: readonly TreeCollectionDto[],
  documentId: string,
): ApiTreeNode | undefined {
  const search = (nodes: readonly ApiTreeNode[]): ApiTreeNode | undefined => {
    for (const node of nodes) {
      if (node.id === documentId) return node
      const inside = search(node.children)
      if (inside !== undefined) return inside
    }
    return undefined
  }
  for (const collection of collections) {
    const found = search(collection.documents)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * The documents beneath one, nested all the way down. How deep to show is the
 * block's setting and not this function's, so the same answer serves a block
 * that shows one level and one that shows five.
 */
export function childDocumentsOf(
  collections: readonly TreeCollectionDto[],
  documentId: string,
  workspaceSlug: string,
): readonly TreeNode[] {
  const node = findTreeNode(collections, documentId)
  return node === undefined ? [] : node.children.map((child) => toTreeNode(workspaceSlug, child))
}
