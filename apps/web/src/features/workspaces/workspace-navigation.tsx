import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'

import {
  Callout,
  Menu,
  onDemand,
  OutlineIcon,
  PlusIcon,
  ProgressBar,
  Spinner,
  Tooltip,
  TooltipProvider,
  Tree,
  tv,
  useOnDemand,
  type IconRailItem,
  type TreeLoadRequest,
  type TreeNode,
  type TreeNodeAction,
  type TreeSection,
} from '@quill/ui'

import { listKey, useMe, useNavigationTree, type NavigationTree } from '../../lib/api/index.ts'
import {
  documentLink,
  documentReference,
  workspaceLink,
} from '../../lib/routing/document-reference.ts'
import { RouterLink } from '../../lib/routing/router-link.tsx'
import { useDocumentActions } from './document-actions.tsx'
import { WorkspaceSwitcher } from './workspace-switcher.tsx'

/**
 * The column's dialogs are their own chunks (quill-plan.md section 31): a
 * reader who never creates anything does not download the forms. They are
 * fetched in idle time once the column is drawn, and at once if a press gets
 * there first (`onDemand` in `@quill/ui`); once here they stay mounted, so they
 * open and close exactly as they always have.
 */
const newDocumentDialog = onDemand(() => import('./new-document-dialog.tsx'))
const collectionDialogs = onDemand(() => import('./collection-dialogs.tsx'))

export const workspaceNavigationStyles = tv({
  slots: {
    root: 'flex flex-col gap-1 pt-4 pb-3',
    header: 'flex items-center justify-between gap-1',
    controls: 'flex shrink-0 items-center gap-0.5',
    add: [
      'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted',
      'transition-colors hover:bg-surface hover:text-foreground',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
    ],
    /*
     * "New" is a row of the sidebar rather than a slab across it: the same
     * shape and ink as the documents under it, with the plus to say what it
     * does, so it is always there and never louder than the list.
     */
    newRow: [
      'flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-xs font-medium',
      'text-foreground-soft transition-colors ease-standard hover:bg-surface hover:text-foreground',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
    ],
    notice: 'px-2 py-2',
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

/** A document and whatever of its children are loaded, as the tree draws it. */
function toTreeNode(workspaceSlug: string, tree: NavigationTree, id: string): TreeNode | undefined {
  const node = tree.nodes.get(id)
  if (node === undefined) return undefined
  const children = tree.lists.get(listKey.document(id))
  return {
    id,
    label: node.title,
    // One helper builds every document address (ADR-035): a route and its
    // parameters, so the router encodes the segments and type-checks the
    // pattern, and nothing here concatenates a URL.
    link: documentLink(workspaceSlug, documentReference(node)),
    childCount: node.childCount,
    childrenOffset: children?.offset ?? 0,
    children: toTreeNodes(workspaceSlug, tree, children?.ids ?? []),
  }
}

function toTreeNodes(
  workspaceSlug: string,
  tree: NavigationTree,
  ids: readonly string[],
): readonly TreeNode[] {
  return ids.flatMap((id) => toTreeNode(workspaceSlug, tree, id) ?? [])
}

/**
 * The collection a loaded document sits in, so "new child" opens preset to
 * both: found by climbing the loaded lists, which always hold the way down to
 * anything drawn.
 */
function findCollectionOf(tree: NavigationTree, documentId: string): string | undefined {
  const parentOf = new Map<string, string>()
  for (const [key, list] of tree.lists) for (const id of list.ids) parentOf.set(id, key)
  let key = parentOf.get(documentId)
  const seen = new Set<string>()
  while (key !== undefined && !seen.has(key)) {
    seen.add(key)
    const collection = tree.collections.find((entry) => listKey.collection(entry.id) === key)
    if (collection !== undefined) return collection.id
    key = parentOf.get(key.slice('document:'.length))
  }
  return undefined
}

/**
 * The tree's sections, with each collection's own "+" and its rename and
 * delete entries wired to the dialogs that answer them.
 */
function toSections(
  workspaceSlug: string,
  tree: NavigationTree | undefined,
  openNewDocument: (preset: NewDocumentPreset) => void,
  openCollectionDialog: (dialog: CollectionDialog) => void,
): readonly TreeSection[] {
  if (tree === undefined) return []
  return tree.collections.map((collection) => {
    const top = tree.lists.get(listKey.collection(collection.id))
    return {
      id: collection.id,
      label: collection.name,
      count: collection.total,
      nodes: toTreeNodes(workspaceSlug, tree, top?.ids ?? []),
      nodeCount: top?.total ?? 0,
      nodesOffset: top?.offset ?? 0,
      action: {
        label: `New document in ${collection.name}`,
        onSelect: () => {
          openNewDocument({ collectionId: collection.id })
        },
      },
      actions: [
        {
          label: 'Rename…',
          onSelect: () => {
            openCollectionDialog({ kind: 'rename', id: collection.id, name: collection.name })
          },
        },
        {
          label: 'Delete…',
          onSelect: () => {
            openCollectionDialog({
              kind: 'delete',
              id: collection.id,
              name: collection.name,
              documentCount: collection.total,
            })
          },
        },
      ],
    }
  })
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
      readonly documentCount: number | undefined
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
  // A level, a page, and the way down to the document being read, with the
  // rest asked for as it is opened (`useNavigationTree`).
  const tree = useNavigationTree(workspaceId, currentDocumentId)
  const loadSlice = tree.load
  const onLoad = useCallback(
    (request: TreeLoadRequest) => {
      loadSlice(
        {
          kind: request.owner.kind === 'section' ? 'collection' : 'document',
          id: request.owner.id,
        },
        request.offset,
        request.limit,
      )
    },
    [loadSlice],
  )
  const failedSlice = tree.loadFailed
  const loadFailed = useCallback(
    (owner: TreeLoadRequest['owner']) =>
      failedSlice({ kind: owner.kind === 'section' ? 'collection' : 'document', id: owner.id }),
    [failedSlice],
  )
  // Moving and deleting the open document are the shell's, not this tree's:
  // the same two dialogs answer the document header's menu (`document-actions.tsx`).
  const documentActions = useDocumentActions()
  const [preset, setPreset] = useState<NewDocumentPreset | undefined>(undefined)
  const [collectionDialog, setCollectionDialog] = useState<CollectionDialog | undefined>(undefined)
  const newDocument = useOnDemand(newDocumentDialog, preset !== undefined)
  const collectionForms = useOnDemand(collectionDialogs, collectionDialog !== undefined)
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

  // Stable across renders, so the tree's memoised rows are not redrawn every
  // time the page around the sidebar settles a query.
  const treeData = tree.data
  const { canManage, openMove, openDelete } = documentActions
  const nodeActions = useCallback(
    (node: TreeNode): readonly TreeNodeAction[] => {
      const actions: TreeNodeAction[] = [
        {
          label: 'New child document',
          onSelect: () => {
            const collectionId =
              treeData === undefined ? undefined : findCollectionOf(treeData, node.id)
            setPreset(
              collectionId === undefined
                ? { parentId: node.id }
                : { collectionId, parentId: node.id },
            )
          },
        },
      ]
      if (canManage && node.id === currentDocumentId) {
        actions.push({ label: 'Move to…', onSelect: openMove })
        actions.push({ label: 'Delete…', onSelect: openDelete })
      }
      return actions
    },
    [treeData, canManage, openMove, openDelete, currentDocumentId],
  )

  // Built once per tree response, not per render: the walk visits every
  // document in the workspace — tens of thousands in a large one — while the
  // tree itself draws only what is open (`@quill/ui`'s `Tree`).
  const sections: readonly TreeSection[] = useMemo(
    () => toSections(workspaceSlug, tree.data, setPreset, setCollectionDialog),
    [workspaceSlug, tree.data],
  )
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
                <PlusIcon />
              </button>
              <WorkspaceOverflow
                workspaceSlug={workspaceSlug}
                workspaceName={workspaceName ?? 'this workspace'}
              />
            </div>
          </div>

          <TooltipProvider>
            <Tooltip content="New document (press c)">
              <button
                type="button"
                className={styles.newRow()}
                onClick={() => {
                  setPreset({})
                }}
              >
                <PlusIcon className="text-muted" />
                {/*
                  "New", not "New document": the workspace home's header
                  carries a "New document" button of its own, and two
                  controls with one name is a worse answer than a short one
                  with a tooltip that says the rest.
                */}
                New
              </button>
            </Tooltip>
          </TooltipProvider>

          {/* Only while a dialog's chunk is still on its way: normally never. */}
          {(preset !== undefined && newDocument === undefined) ||
          (collectionDialog !== undefined && collectionForms === undefined) ? (
            <ProgressBar placement="top" label="Opening the dialog" />
          ) : undefined}

          {newDocument === undefined ? undefined : (
            <newDocument.NewDocumentDialog
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
          )}

          {collectionForms === undefined ? undefined : (
            <>
              <collectionForms.CreateCollectionDialog
                open={collectionDialog?.kind === 'create'}
                onOpenChange={(open) => {
                  if (!open) setCollectionDialog(undefined)
                }}
                workspaceId={workspaceId}
              />
              {collectionDialog?.kind === 'rename' ? (
                <collectionForms.RenameCollectionDialog
                  open
                  onOpenChange={(open) => {
                    if (!open) setCollectionDialog(undefined)
                  }}
                  collectionId={collectionDialog.id}
                  currentName={collectionDialog.name}
                />
              ) : undefined}
              {collectionDialog?.kind === 'delete' ? (
                <collectionForms.DeleteCollectionDialog
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
          // One tree per workspace, so what was opened by hand in one is not
          // applied to another; remembered for the tab's session.
          key={workspaceId}
          persistenceKey={workspaceId}
          label="Documents"
          sections={sections}
          nodeActions={nodeActions}
          linkComponent={RouterLink}
          onLoad={onLoad}
          loadFailed={loadFailed}
          {...(currentDocumentId === undefined ? {} : { currentId: currentDocumentId })}
        />
      )}
    </section>
  )
}

interface WorkspaceOverflowProps {
  readonly workspaceSlug: string
  readonly workspaceName: string
}

/**
 * The workspace's own overflow menu, beside the control that adds a
 * collection: where something that is about *this workspace* rather than
 * about a document in it is reached.
 *
 * Today that is one entry, its settings (ADR-028's amendment: layout is the
 * workspace's). It is rendered only for somebody who can open that page, so
 * the menu is absent rather than offering an entry that answers "not found" —
 * a menu with nothing in it is not a menu (`docs/design/feedback.md`).
 *
 * TODO(M3): the check is instance administration, which is narrower than the
 * rule. Changing a workspace's layout needs `manage` on it, and no route
 * answers what this person may do with a workspace yet — see the route's own
 * note in `routes/_authenticated/w/$workspaceSlug/settings.tsx`.
 */
function WorkspaceOverflow({ workspaceSlug, workspaceName }: WorkspaceOverflowProps) {
  const me = useMe()
  const navigate = useNavigate()

  if (me.data?.isInstanceAdmin !== true) return undefined

  return (
    <Menu
      /*
       * "More actions for **the Engineering workspace**", not "for
       * Engineering". `Menu` builds its trigger's accessible name from this,
       * and the tree below it gives every document row a menu named the same
       * way — so a bare workspace name is one of twenty near-identical
       * controls, and is indistinguishable from a document that happens to
       * share the name. The noun is what separates them, for a screen reader
       * and for anything else reading the page.
       */
      label={`the ${workspaceName} workspace`}
      align="end"
      items={[
        {
          label: 'Workspace settings',
          onSelect: () => {
            void navigate({ to: '/w/$workspaceSlug/settings', params: { workspaceSlug } })
          },
        },
      ]}
    />
  )
}
