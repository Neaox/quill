import { useMemo, useState } from 'react'

import { Button, Dialog, Spinner, Tree, type TreeSection } from '@quill/ui'

import {
  useMoveDocument,
  useWorkspaceTree,
  type TreeCollectionDto,
  type WorkspaceTreeResponse,
} from '../../lib/api/index.ts'
import { FormError } from '../../lib/forms/form-error.tsx'

export interface MoveDocumentDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly workspaceId: string
  readonly documentId: string
  readonly documentTitle: string
  readonly currentCollectionId: string | null
  readonly currentParentId: string | null
}

type ApiTreeNode = TreeCollectionDto['documents'][number]

interface Destination {
  readonly collectionId: string
  readonly parentId: string | null
}

const TOP_LEVEL_PREFIX = 'top:'
const DOCUMENT_PREFIX = 'doc:'

/**
 * A node's picker id carries its collection along with it (`doc:<collectionId>:<documentId>`),
 * so choosing it resolves straight to a `Destination` with no second lookup —
 * `TreeNode` (`docs/architecture/api-contract-m2.md`) does not itself carry a
 * `collectionId`, only the id of the document.
 */
function documentNodeId(collectionId: string, node: ApiTreeNode): string {
  return `${DOCUMENT_PREFIX}${collectionId}:${node.id}`
}

function parseSelection(id: string): Destination | undefined {
  if (id.startsWith(TOP_LEVEL_PREFIX)) {
    return { collectionId: id.slice(TOP_LEVEL_PREFIX.length), parentId: null }
  }
  if (id.startsWith(DOCUMENT_PREFIX)) {
    const rest = id.slice(DOCUMENT_PREFIX.length)
    const separator = rest.indexOf(':')
    if (separator === -1) return undefined
    return { collectionId: rest.slice(0, separator), parentId: rest.slice(separator + 1) }
  }
  return undefined
}

/**
 * Ids of `documentId` and everything nested beneath it, wherever it sits in
 * the tree: a document cannot be moved into its own subtree (client-side
 * guard; the server enforces it too).
 */
function subtreeIds(
  collections: readonly TreeCollectionDto[],
  documentId: string,
): ReadonlySet<string> {
  const ids = new Set<string>()

  function markSubtree(node: ApiTreeNode) {
    ids.add(node.id)
    for (const child of node.children) markSubtree(child)
  }

  function walk(nodes: readonly ApiTreeNode[]) {
    for (const node of nodes) {
      if (node.id === documentId) {
        markSubtree(node)
      } else {
        walk(node.children)
      }
    }
  }

  walk(collections.flatMap((collection) => collection.documents))
  return ids
}

function toPickerSections(
  tree: WorkspaceTreeResponse,
  excludedIds: ReadonlySet<string>,
  current: Destination,
): readonly TreeSection[] {
  function toPickerNode(collectionId: string, node: ApiTreeNode): TreeSection['nodes'][number] {
    const disabled = excludedIds.has(node.id)
    return {
      id: documentNodeId(collectionId, node),
      label: node.title,
      disabled,
      disabledReason: disabled ? 'Would move the document into itself' : undefined,
      current: current.parentId === node.id,
      children: node.children.map((child) => toPickerNode(collectionId, child)),
    }
  }

  return tree.collections.map((collection) => ({
    id: collection.id,
    label: collection.name,
    nodes: [
      {
        id: `${TOP_LEVEL_PREFIX}${collection.id}`,
        // Named after its collection rather than a bare "Top level": several
        // collections each have one, and a screen reader reading this button
        // out of its section's context should still say where it is.
        label: `Top level of ${collection.name}`,
        current: current.parentId === null && current.collectionId === collection.id,
      },
      ...collection.documents.map((node) => toPickerNode(collection.id, node)),
    ],
  }))
}

/**
 * "Move to…": the workspace's collections and documents as a destination
 * picker, reachable from the document header and from the tree item's
 * overflow menu (`document-page.tsx`, `workspace-navigation.tsx`).
 *
 * Reuses `GET /workspaces/:id/tree` — the same nested shape the workspace
 * tree and the "New document" collection picker already read — rather than a
 * route of its own, and `@quill/ui`'s `Tree` in its `selectable` mode rather
 * than one-off markup.
 */
export function MoveDocumentDialog({
  open,
  onOpenChange,
  workspaceId,
  documentId,
  documentTitle,
  currentCollectionId,
  currentParentId,
}: MoveDocumentDialogProps) {
  const tree = useWorkspaceTree(open ? workspaceId : undefined)
  const moveDocument = useMoveDocument()
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)

  const current: Destination = useMemo(
    () => ({ collectionId: currentCollectionId ?? '', parentId: currentParentId }),
    [currentCollectionId, currentParentId],
  )

  const excludedIds = useMemo(
    () =>
      tree.data === undefined ? new Set<string>() : subtreeIds(tree.data.collections, documentId),
    [tree.data, documentId],
  )
  const sections = useMemo(
    () => (tree.data === undefined ? [] : toPickerSections(tree.data, excludedIds, current)),
    [tree.data, excludedIds, current],
  )

  const destination = selectedId === undefined ? undefined : parseSelection(selectedId)
  const unchanged =
    destination !== undefined &&
    destination.collectionId === current.collectionId &&
    destination.parentId === current.parentId

  function close() {
    onOpenChange(false)
    setSelectedId(undefined)
    moveDocument.reset()
  }

  function confirm() {
    if (destination === undefined) return
    moveDocument.mutate(
      { documentId, collectionId: destination.collectionId, parentId: destination.parentId },
      { onSuccess: close },
    )
  }

  return (
    <Dialog
      title="Move to…"
      description={`Choose a new location for "${documentTitle}".`}
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            loading={moveDocument.isPending}
            disabled={destination === undefined || unchanged}
            onClick={confirm}
          >
            Move
          </Button>
        </>
      }
    >
      {tree.isPending ? (
        <Spinner className="size-4" />
      ) : (
        <Tree
          label="Choose a destination"
          sections={sections}
          selectable
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      )}
      <FormError error={moveDocument.error} />
    </Dialog>
  )
}
