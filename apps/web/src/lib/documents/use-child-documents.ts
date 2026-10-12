import { useMemo } from 'react'

import type { TreeNode } from '@quill/ui'

import { useWorkspaceTree } from '../api/index.ts'
import type { DocumentDto } from '../api/index.ts'
import { childDocumentsOf } from './tree-nodes.ts'

/**
 * The documents beneath a document, from the workspace tree the sidebar has
 * already fetched: the same query, so showing them costs no request of its own
 * and can never disagree with the sidebar about what is there.
 *
 * It takes the document itself rather than the reference in the address bar,
 * because the tree is keyed by a document's id and a reference is only how a
 * person got here (ADR-035).
 *
 * Derived, not stored: the list is a function of the tree, recomputed only when
 * the tree is replaced. `undefined` is "the tree has not arrived yet", which is
 * not the same as "there are none", and a caller shows the two differently.
 */
export function useChildDocuments(
  document: Pick<DocumentDto, 'id' | 'workspaceId'> | undefined,
  workspaceSlug: string,
): readonly TreeNode[] | undefined {
  const collections = useWorkspaceTree(document?.workspaceId).data?.collections
  const id = document?.id
  return useMemo(
    () =>
      collections === undefined || id === undefined
        ? undefined
        : childDocumentsOf(collections, id, workspaceSlug),
    [collections, id, workspaceSlug],
  )
}
