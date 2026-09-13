import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

import {
  useDocument,
  useDocumentEnvelope,
  useWorkspaceTree,
  type TreeCollectionDto,
} from '../../lib/api/index.ts'
import { DeleteDocumentDialog } from './delete-document-dialog.tsx'
import { MoveDocumentDialog } from './move-document-dialog.tsx'

type ApiTreeNode = TreeCollectionDto['documents'][number]

/**
 * What can be done to the document currently open, and how to start it.
 *
 * Moving and deleting a document are offered from two places — the tree row
 * and the document header — and they are the same two dialogs either way, so
 * the dialogs and their state live here, once, and both places are triggers.
 * A person without `manage` gets `canManage: false` and neither trigger is
 * rendered at all, rather than a control that does nothing when pressed
 * (`docs/design/feedback.md`).
 */
export interface DocumentActions {
  readonly canManage: boolean
  readonly openMove: () => void
  readonly openDelete: () => void
}

const noAction = () => undefined

const DocumentActionsContext = createContext<DocumentActions>({
  canManage: false,
  openMove: noAction,
  openDelete: noAction,
})

export function useDocumentActions(): DocumentActions {
  return useContext(DocumentActionsContext)
}

/** How many documents are nested directly under this one, from the workspace tree. */
function countChildren(collections: readonly TreeCollectionDto[], documentId: string): number {
  const find = (nodes: readonly ApiTreeNode[]): ApiTreeNode | undefined => {
    for (const node of nodes) {
      if (node.id === documentId) return node
      const inChildren = find(node.children)
      if (inChildren !== undefined) return inChildren
    }
    return undefined
  }
  return find(collections.flatMap((collection) => collection.documents))?.children.length ?? 0
}

export interface DocumentActionsProviderProps {
  readonly workspaceSlug: string
  readonly workspaceId: string
  /** The reference from the URL. */
  readonly documentId: string
  /** The id that reference resolved to, once it has: what the tree matches on, and what a write addresses. */
  readonly resolvedDocumentId?: string | undefined
  readonly children: ReactNode
}

/**
 * Mounted by the workspace layout only while a document is open, so the
 * envelope it needs — the one route that answers "may this person manage this
 * document" — is fetched for a document that exists, and never for the
 * workspace home. It is the same cache entry the reading page reads, so this
 * costs no extra request.
 */
export function DocumentActionsProvider({
  workspaceSlug,
  workspaceId,
  documentId,
  resolvedDocumentId,
  children,
}: DocumentActionsProviderProps) {
  const document = useDocument(documentId)
  const envelope = useDocumentEnvelope(documentId)
  const tree = useWorkspaceTree(workspaceId)
  const [moveOpen, setMoveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const canManage = envelope.data?.permissions.manage === true
  const actions = useMemo<DocumentActions>(
    () => ({
      canManage,
      openMove: () => {
        setMoveOpen(true)
      },
      openDelete: () => {
        setDeleteOpen(true)
      },
    }),
    [canManage],
  )

  return (
    <DocumentActionsContext value={actions}>
      {children}
      {canManage && document.data !== undefined ? (
        <>
          {/*
            A write addresses the *resolved* id, not the spelling in the
            address bar (ADR-035): the API resolves either, but the cache
            entries a move or a delete has to disturb are keyed by the id.
          */}
          <MoveDocumentDialog
            open={moveOpen}
            onOpenChange={setMoveOpen}
            workspaceId={workspaceId}
            documentId={resolvedDocumentId ?? documentId}
            documentTitle={document.data.title}
            currentCollectionId={document.data.collectionId}
            currentParentId={document.data.parentId}
          />
          <DeleteDocumentDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            workspaceSlug={workspaceSlug}
            workspaceId={workspaceId}
            documentId={resolvedDocumentId ?? documentId}
            title={document.data.title}
            childCount={countChildren(
              tree.data?.collections ?? [],
              resolvedDocumentId ?? documentId,
            )}
          />
        </>
      ) : undefined}
    </DocumentActionsContext>
  )
}
