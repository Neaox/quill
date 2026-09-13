import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from 'react'

import {
  useDocument,
  useDocumentEnvelope,
  useWorkspaceTree,
  type TreeCollectionDto,
} from '../../lib/api/index.ts'
import { DeleteDocumentDialog } from './delete-document-dialog.tsx'
import { MoveDocumentDialog } from './move-document-dialog.tsx'

/**
 * Sharing is its own chunk, and its own module graph — the link list, the
 * create form, the one-time address — that a reader who never shares anything
 * should not pay for on the reading route (quill-plan.md section 31). It is
 * loaded the first time Share is pressed and stays mounted afterwards, so the
 * dialog's own open and close behaviour is unaffected.
 */
const ShareDialog = lazy(async () => ({
  default: (await import('../share/share-dialog.tsx')).ShareDialog,
}))

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
  /** Share links are managed by whoever may grant access here (ADR-012). */
  readonly openShare: () => void
  /**
   * True while the share dialog's chunk is still on the way, so the control
   * that was pressed carries the work rather than swallowing the click
   * (`docs/design/feedback.md`).
   */
  readonly isOpeningShare: boolean
}

const noAction = () => undefined

const DocumentActionsContext = createContext<DocumentActions>({
  canManage: false,
  openMove: noAction,
  openDelete: noAction,
  openShare: noAction,
  isOpeningShare: false,
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
  const [shareOpen, setShareOpen] = useState(false)
  /**
   * How many times Share has been pressed: zero means its chunk has never
   * been asked for, and every other value is a fresh opening. It keys the
   * dialog, so "the moment this was opened" is a mount — which is what the
   * dialog's own `openedAt` depends on, and what makes reopening Share in a
   * tab left open all afternoon read the clock again.
   */
  const [shareOpenings, setShareOpenings] = useState(0)
  /*
   * The share dialog is a lazy chunk, so the press that asks for it starts
   * something that takes time. Marking the state change as a transition is
   * what turns "the chunk is still arriving" into a flag the pressed control
   * can wear — `docs/design/feedback.md`'s rule for an async handler with no
   * mutation hook of its own. Without it the button is inert for the length
   * of a download on a slow connection.
   */
  const [isOpeningShare, beginOpeningShare] = useTransition()

  const canManage = envelope.data?.permissions.manage === true
  const actions = useMemo<DocumentActions>(
    () => ({
      canManage,
      isOpeningShare,
      openMove: () => {
        setMoveOpen(true)
      },
      openDelete: () => {
        setDeleteOpen(true)
      },
      openShare: () => {
        beginOpeningShare(async () => {
          // Awaited rather than left to `lazy` to suspend on, so the pending
          // window is a fact this component holds: the flag is true until the
          // chunk is in the module registry, from which `lazy` then resolves
          // without a frame of nothing.
          await import('../share/share-dialog.tsx')
          setShareOpenings((opened) => opened + 1)
          setShareOpen(true)
        })
      },
    }),
    [canManage, isOpeningShare, beginOpeningShare],
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
          {shareOpenings === 0 ? undefined : (
            <Suspense fallback={null}>
              <ShareDialog
                key={shareOpenings}
                open={shareOpen}
                onOpenChange={setShareOpen}
                documentId={resolvedDocumentId ?? documentId}
                title={document.data.title}
              />
            </Suspense>
          )}
        </>
      ) : undefined}
    </DocumentActionsContext>
  )
}
