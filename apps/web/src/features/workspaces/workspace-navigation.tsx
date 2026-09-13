import { useEffect, useId, useState } from 'react'

import {
  Button,
  Callout,
  OutlineIcon,
  Spinner,
  Tooltip,
  TooltipProvider,
  Tree,
  tv,
  type IconRailItem,
  type TreeNode,
  type TreeNodeAction,
  type TreeSection,
} from '@quill/ui'

import { useWorkspaceTree, type TreeCollectionDto } from '../../lib/api/index.ts'
import {
  documentLink,
  documentReference,
  workspaceLink,
} from '../../lib/routing/document-reference.ts'
import { RouterLink } from '../../lib/routing/router-link.tsx'
import {
  CreateCollectionDialog,
  DeleteCollectionDialog,
  RenameCollectionDialog,
} from './collection-dialogs.tsx'
import { useDocumentActions } from './document-actions.tsx'
import { NewDocumentDialog } from './new-document-dialog.tsx'
import { WorkspaceSwitcher } from './workspace-switcher.tsx'

type ApiTreeNode = TreeCollectionDto['documents'][number]

export const workspaceNavigationStyles = tv({
  slots: {
    root: 'flex flex-col gap-1 py-3',
    header: 'flex items-center justify-between gap-2 px-3',
    heading: 'meta truncate text-muted',
    controls: 'flex shrink-0 items-center gap-1',
    add: [
      'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted',
      'transition-colors hover:bg-surface hover:text-foreground',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
    ],
    newRow: 'flex items-center px-3 pt-1.5 pb-0.5',
    notice: 'px-3 py-2',
  },
})

/** The icon rail's sections for a workspace. Only "Documents" exists so far. */
export function buildRailItems(workspaceSlug: string): readonly IconRailItem[] {
  return [
    {
      id: 'documents',
      label: 'Documents',
      icon: <OutlineIcon />,
      link: workspaceLink(workspaceSlug),
    },
  ]
}

/** A single-letter shortcut (`c`) for "new document", inert inside any field, input, or editor. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

function toTreeNode(workspaceSlug: string, node: ApiTreeNode): TreeNode {
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

/** Every document in a collection, nesting included: what "is it empty" means. */
function countDocuments(nodes: readonly ApiTreeNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countDocuments(node.children), 0)
}

/** The collection a document sits in, so "new child" opens preset to both. */
function findCollectionOf(
  collections: readonly TreeCollectionDto[],
  documentId: string,
): TreeCollectionDto | undefined {
  const holds = (nodes: readonly ApiTreeNode[]): boolean =>
    nodes.some((node) => node.id === documentId || holds(node.children))
  return collections.find((collection) => holds(collection.documents))
}

/** What the "New document" dialog is opened for: a collection, a parent, or neither. */
interface NewDocumentPreset {
  readonly collectionId?: string
  readonly parentId?: string
}

/** Which collection dialog is open, and about which collection. */
type CollectionDialog =
  | { readonly kind: 'create' }
  | { readonly kind: 'rename'; readonly id: string; readonly name: string }
  | {
      readonly kind: 'delete'
      readonly id: string
      readonly name: string
      readonly documentCount: number
    }

export interface WorkspaceTreeProps {
  readonly workspaceSlug: string
  /** The workspace whose tree is drawn. Without one, nothing is: the tree is its contents. */
  readonly workspaceId?: string | undefined
  /** Shown as the sidebar's heading, beside the control that adds a collection. */
  readonly workspaceName?: string | undefined
  readonly currentDocumentId?: string
}

/**
 * The workspace's navigation sidebar: its name, the control that adds a
 * collection, the control that adds a document, and the tree itself.
 *
 * The tree is drawn from `GET /workspaces/:id/tree` — the one route that
 * knows collections, their order, and which document is nested under which —
 * so the sidebar shows the server's order rather than a second opinion
 * assembled from the flat list, and a child document appears under its parent.
 *
 * Every organise flow that belongs to a place in the tree starts here: a
 * collection's own "+" and overflow menu, a document row's "New child
 * document", and — for the document being read, the only one whose
 * permissions this browser has been told — "Move to…" and "Delete…". The `c`
 * shortcut opens the same "New document" dialog as the rest.
 */
export function WorkspaceTree({
  workspaceSlug,
  workspaceId,
  workspaceName,
  currentDocumentId,
}: WorkspaceTreeProps) {
  const tree = useWorkspaceTree(workspaceId)
  // Moving and deleting the open document are the shell's, not this tree's:
  // the same two dialogs answer the document header's menu (`document-actions.tsx`).
  const documentActions = useDocumentActions()
  const [preset, setPreset] = useState<NewDocumentPreset | undefined>(undefined)
  const [collectionDialog, setCollectionDialog] = useState<CollectionDialog | undefined>(undefined)
  const styles = workspaceNavigationStyles()
  const headingId = useId()

  // Subscribes to the window's keydown stream — an external system — for the
  // `c` "new document" shortcut, so it fires from wherever focus is on the
  // page rather than only while the tree itself has it.
  useEffect(() => {
    if (workspaceId === undefined) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'c' || event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      setPreset({})
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [workspaceId])

  const collections = tree.data?.collections ?? []

  function newChildPreset(parentDocumentId: string) {
    const collection = findCollectionOf(collections, parentDocumentId)
    setPreset(
      collection === undefined
        ? { parentId: parentDocumentId }
        : { collectionId: collection.id, parentId: parentDocumentId },
    )
  }

  function nodeActions(node: TreeNode): readonly TreeNodeAction[] {
    const actions: TreeNodeAction[] = [
      {
        label: 'New child document',
        onSelect: () => {
          newChildPreset(node.id)
        },
      },
    ]
    if (documentActions.canManage && node.id === currentDocumentId) {
      actions.push({ label: 'Move to…', onSelect: documentActions.openMove })
      actions.push({ label: 'Delete…', onSelect: documentActions.openDelete })
    }
    return actions
  }

  const sections: readonly TreeSection[] = collections.map((collection) => ({
    id: collection.id,
    label: collection.name,
    nodes: collection.documents.map((node) => toTreeNode(workspaceSlug, node)),
    action: {
      label: `New document in ${collection.name}`,
      onSelect: () => {
        setPreset({ collectionId: collection.id })
      },
    },
    actions: [
      {
        label: 'Rename…',
        onSelect: () => {
          setCollectionDialog({ kind: 'rename', id: collection.id, name: collection.name })
        },
      },
      {
        label: 'Delete…',
        onSelect: () => {
          setCollectionDialog({
            kind: 'delete',
            id: collection.id,
            name: collection.name,
            documentCount: countDocuments(collection.documents),
          })
        },
      },
    ],
  }))

  return (
    // A region named by its own heading, so the column's chrome — the
    // switcher and the New control — sits inside a landmark like the tree
    // below it (WCAG 1.3.6; axe's `region` rule), rather than in the gap
    // between the rail and the document.
    <section className={styles.root()} aria-labelledby={headingId}>
      {workspaceId === undefined ? undefined : (
        <>
          <div className={styles.header()}>
            <h2 id={headingId} className="sr-only">
              {workspaceName ?? 'Documents'}
            </h2>
            <WorkspaceSwitcher
              activeWorkspaceId={workspaceId}
              activeWorkspaceName={workspaceName ?? 'Workspace'}
            />
            <div className={styles.controls()}>
              <button
                type="button"
                className={styles.add()}
                aria-label="New collection"
                title="New collection"
                onClick={() => {
                  setCollectionDialog({ kind: 'create' })
                }}
              >
                <span aria-hidden="true">+</span>
              </button>
            </div>
          </div>

          <div className={styles.newRow()}>
            <TooltipProvider>
              <Tooltip content="New document (press c)">
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    setPreset({})
                  }}
                >
                  {/*
                    "New", not "New document": the workspace home's header
                    carries a "New document" button of its own, and two
                    controls with one name is a worse answer than a short one
                    with a tooltip that says the rest.
                  */}
                  New
                </Button>
              </Tooltip>
            </TooltipProvider>
          </div>

          <NewDocumentDialog
            // A fresh instance per preset, keyed on the destination it opens
            // to: `open` flipping true from *outside* is not something the
            // dialog's own `onOpenChange` fires for, so remounting is what
            // guarantees `initialCollectionId`/`initialParentId` seed the
            // form correctly on every distinct entry point.
            key={
              preset === undefined
                ? 'closed'
                : `${preset.collectionId ?? ''}:${preset.parentId ?? ''}`
            }
            workspaceId={workspaceId}
            workspaceSlug={workspaceSlug}
            open={preset !== undefined}
            onOpenChange={(open) => {
              if (!open) setPreset(undefined)
            }}
            {...(preset?.collectionId === undefined
              ? {}
              : { initialCollectionId: preset.collectionId })}
            {...(preset?.parentId === undefined ? {} : { initialParentId: preset.parentId })}
          />

          <CreateCollectionDialog
            open={collectionDialog?.kind === 'create'}
            onOpenChange={(open) => {
              if (!open) setCollectionDialog(undefined)
            }}
            workspaceId={workspaceId}
          />
          {collectionDialog?.kind === 'rename' ? (
            <RenameCollectionDialog
              open
              onOpenChange={(open) => {
                if (!open) setCollectionDialog(undefined)
              }}
              collectionId={collectionDialog.id}
              currentName={collectionDialog.name}
            />
          ) : undefined}
          {collectionDialog?.kind === 'delete' ? (
            <DeleteCollectionDialog
              open
              onOpenChange={(open) => {
                if (!open) setCollectionDialog(undefined)
              }}
              workspaceId={workspaceId}
              collectionId={collectionDialog.id}
              name={collectionDialog.name}
              documentCount={collectionDialog.documentCount}
            />
          ) : undefined}
        </>
      )}

      {tree.isPending ? (
        <p className={styles.notice()} aria-busy="true">
          <Spinner />
        </p>
      ) : tree.isError ? (
        <div className={styles.notice()}>
          <Callout tone="danger" title="Couldn't load the documents">
            Reload the page to try again.
          </Callout>
        </div>
      ) : (
        <Tree
          label="Documents"
          sections={sections}
          nodeActions={nodeActions}
          linkComponent={RouterLink}
          {...(currentDocumentId === undefined ? {} : { currentId: currentDocumentId })}
        />
      )}
    </section>
  )
}
