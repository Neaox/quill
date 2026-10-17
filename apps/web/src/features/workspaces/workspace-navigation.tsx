import { useNavigate } from '@tanstack/react-router'
import { lazy, useEffect, useId, useState } from 'react'

import {
  Callout,
  Menu,
  OutlineIcon,
  PlusIcon,
  Spinner,
  Tooltip,
  TooltipProvider,
  tv,
  VirtualTree,
  type IconRailItem,
  type TreeNodeAction,
} from '@quill/ui'

import { useMe, useTreeCollections } from '../../lib/api/index.ts'
import { workspaceLink } from '../../lib/routing/document-reference.ts'
import { RouterLink } from '../../lib/routing/router-link.tsx'
import { MountOnFirstOpen } from '../../lib/mount-on-first-open.tsx'
import { useDocumentActions } from './document-actions.tsx'
import { useTreeRows } from './use-tree-rows.ts'
import { WorkspaceSwitcher } from './workspace-switcher.tsx'

const CreateCollectionDialog = lazy(async () => ({
  default: (await import('./collection-dialogs.tsx')).CreateCollectionDialog,
}))
const RenameCollectionDialog = lazy(async () => ({
  default: (await import('./collection-dialogs.tsx')).RenameCollectionDialog,
}))
const DeleteCollectionDialog = lazy(async () => ({
  default: (await import('./collection-dialogs.tsx')).DeleteCollectionDialog,
}))
const NewDocumentDialog = lazy(async () => ({
  default: (await import('./new-document-dialog.tsx')).NewDocumentDialog,
}))

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
  const collectionsQuery = useTreeCollections(workspaceId)
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

  const collections = collectionsQuery.data ?? []

  function nodeActions(node: {
    readonly id: string
    readonly collectionId: string
  }): readonly TreeNodeAction[] {
    const actions: TreeNodeAction[] = [
      {
        label: 'New child document',
        onSelect: () => {
          setPreset({ collectionId: node.collectionId, parentId: node.id })
        },
      },
    ]
    if (documentActions.canManage && node.id === currentDocumentId) {
      actions.push({ label: 'Move to…', onSelect: documentActions.openMove })
      actions.push({ label: 'Delete…', onSelect: documentActions.openDelete })
    }
    return actions
  }

  const { rows, toggle, more } = useTreeRows({
    workspaceId: workspaceId ?? '',
    workspaceSlug,
    collections,
    currentId: currentDocumentId,
    nodeActions,
    section: (collection) => ({
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
            // Whether it is empty is the server's to say: the tree knows a page at a time, so the
            // count is not known here and the dialog says so rather than claiming none.
            setCollectionDialog({
              kind: 'delete',
              id: collection.id,
              name: collection.name,
              documentCount: undefined,
            })
          },
        },
      ],
    }),
  })

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

          <MountOnFirstOpen open={preset !== undefined}>
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
          </MountOnFirstOpen>

          <MountOnFirstOpen open={collectionDialog?.kind === 'create'}>
            <CreateCollectionDialog
              open={collectionDialog?.kind === 'create'}
              onOpenChange={(open) => {
                if (!open) setCollectionDialog(undefined)
              }}
              workspaceId={workspaceId}
            />
          </MountOnFirstOpen>
          {collectionDialog?.kind === 'rename' ? (
            <MountOnFirstOpen open>
              <RenameCollectionDialog
                open
                onOpenChange={(open) => {
                  if (!open) setCollectionDialog(undefined)
                }}
                collectionId={collectionDialog.id}
                currentName={collectionDialog.name}
              />
            </MountOnFirstOpen>
          ) : undefined}
          {collectionDialog?.kind === 'delete' ? (
            <MountOnFirstOpen open>
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
            </MountOnFirstOpen>
          ) : undefined}
        </>
      )}

      {collectionsQuery.isPending ? (
        <p className={styles.notice()} aria-busy="true">
          <Spinner />
        </p>
      ) : collectionsQuery.isError ? (
        <div className={styles.notice()}>
          <Callout tone="danger" title="Couldn't load the documents">
            Reload the page to try again.
          </Callout>
        </div>
      ) : (
        <VirtualTree
          label="Documents"
          rows={rows}
          onToggle={toggle}
          onMore={more}
          linkComponent={RouterLink}
          // The window is cut from this: tall enough to use, short enough to leave the controls above it.
          className="max-h-[calc(100dvh-var(--spacing-shell-header)-9rem)] max-md:max-h-96"
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
