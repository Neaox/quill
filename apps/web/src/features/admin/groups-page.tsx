import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { Button, buttonClassName, Callout, PlusIcon, Spinner, tv } from '@quill/ui'

import { useGroups, type GroupSummaryDto } from '../../lib/api/index.ts'
import { AppPage } from '../layout/app-page.tsx'
import { arrangeGroups } from './arrange-groups.ts'
import { CreateGroupDialog, DeleteGroupDialog, RenameGroupDialog } from './group-dialogs.tsx'
import { GroupDetail } from './group-detail.tsx'

export const groupsPageStyles = tv({
  slots: {
    layout: 'grid items-start gap-8 md:grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)]',
    // On a phone one pane at a time: the list, or the group chosen from it.
    list: 'flex min-w-0 flex-col gap-5',
    unit: 'flex flex-col gap-1',
    unitName: 'px-2 text-2xs font-medium tracking-wide text-muted uppercase',
    groups: 'flex flex-col gap-0.5',
    row: [
      'focus-ring flex min-h-9 items-center gap-2 rounded-md py-1.5 pe-2 ps-2 text-sm text-foreground',
      'hover:bg-surface aria-[current=page]:bg-accent-subtle aria-[current=page]:font-medium',
    ],
    rowName: 'min-w-0 grow truncate',
    rowCount: 'shrink-0 text-xs text-muted tabular-nums',
    pane: 'min-w-0',
    placeholder: [
      'rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted',
    ],
    busy: 'flex items-center gap-2 text-sm text-muted',
  },
  variants: {
    // Below `md` only the pane that has something to show is on screen.
    hasSelection: {
      true: { list: 'max-md:hidden' },
      false: { pane: 'max-md:hidden' },
    },
    // How far a nested group is set in; deeper than three levels reads as the third.
    depth: {
      top: {},
      nested: { row: 'ps-6' },
      deeper: { row: 'ps-10' },
      deepest: { row: 'ps-14' },
    },
  },
  defaultVariants: { depth: 'top' },
})

const DEPTHS = ['top', 'nested', 'deeper', 'deepest'] as const

const routeApi = getRouteApi('/_authenticated/admin/groups')

type GroupsDialog =
  | { readonly kind: 'new'; readonly unitId?: string; readonly parentGroupId?: string }
  | { readonly kind: 'rename'; readonly group: GroupSummaryDto }
  | { readonly kind: 'delete'; readonly group: GroupSummaryDto }

/**
 * People and groups (ADR-052): every group, by unit, and who is in the one
 * chosen.
 *
 * A group is what a grant names when "the design team" should have access
 * rather than each person separately, so this is where an instance
 * administrator keeps those teams. The chosen group is in the address
 * (`?group=`), so one group can be linked to and the back button leaves it.
 */
export function GroupsPage() {
  const groups = useGroups()
  const { group: selectedId } = routeApi.useSearch()
  const navigate = useNavigate({ from: '/admin/groups' })
  const [dialog, setDialog] = useState<GroupsDialog | undefined>(undefined)

  const all = groups.data ?? []
  const selected = all.find((group) => group.id === selectedId)
  const styles = groupsPageStyles({ hasSelection: selected !== undefined })

  function closeDialog() {
    setDialog(undefined)
  }

  function select(groupId: string | undefined) {
    void navigate({ search: groupId === undefined ? {} : { group: groupId } })
  }

  return (
    <AppPage
      width="full"
      actions={
        <>
          <Link
            to="/admin/organisation"
            className={buttonClassName({
              size: 'sm',
              variant: 'ghost',
              className: 'max-sm:hidden',
            })}
          >
            Units and workspaces
          </Link>
          <Button
            size="sm"
            iconStart={<PlusIcon className="size-3.5" aria-hidden="true" />}
            onClick={() => {
              setDialog({
                kind: 'new',
                ...(selected === undefined ? {} : { unitId: selected.unitId }),
              })
            }}
          >
            New group
          </Button>
        </>
      }
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">People and groups</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          A group is a set of people. Give a group access to a unit or a workspace and everyone in
          it has that access, so a team changes in one place.
        </p>
      </div>

      {groups.isPending ? (
        <p aria-busy="true" className={styles.busy()}>
          <Spinner /> Loading groups
        </p>
      ) : groups.isError ? (
        <Callout tone="danger" title="Couldn't load the groups">
          Reload the page to try again.
        </Callout>
      ) : all.length === 0 ? (
        <Callout tone="info" title="No groups yet">
          Create the first one, then add the people who belong in it. Groups live inside a unit, so
          you will need a unit first.
        </Callout>
      ) : (
        <div className={styles.layout()}>
          <nav aria-label="Groups" className={styles.list()}>
            {arrangeGroups(all).map((section) => (
              <div
                key={section.unitId}
                role="group"
                aria-labelledby={`unit-${section.unitId}`}
                className={styles.unit()}
              >
                <h2 id={`unit-${section.unitId}`} className={styles.unitName()}>
                  {section.unitPath}
                </h2>
                <ul className={styles.groups()}>
                  {section.rows.map(({ group, depth }) => (
                    <li key={group.id}>
                      <Link
                        to="/admin/groups"
                        search={{ group: group.id }}
                        className={styles.row({
                          depth: DEPTHS[Math.min(depth, DEPTHS.length - 1)],
                        })}
                      >
                        <span className={styles.rowName()}>{group.name}</span>
                        <span className={styles.rowCount()}>
                          {group.memberCount}
                          <span className="sr-only">
                            {group.memberCount === 1 ? ' member' : ' members'}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className={styles.pane()}>
            {selected === undefined ? (
              <p className={styles.placeholder()}>
                {selectedId === undefined
                  ? 'Choose a group to see who is in it.'
                  : 'That group no longer exists. Choose another from the list.'}
              </p>
            ) : (
              <GroupDetail
                key={selected.id}
                group={selected}
                onRename={() => {
                  setDialog({ kind: 'rename', group: selected })
                }}
                onDelete={() => {
                  setDialog({ kind: 'delete', group: selected })
                }}
                onNewNested={() => {
                  setDialog({
                    kind: 'new',
                    unitId: selected.unitId,
                    parentGroupId: selected.id,
                  })
                }}
              />
            )}
          </div>
        </div>
      )}

      <CreateGroupDialog
        key={
          dialog?.kind === 'new'
            ? `${dialog.unitId ?? ''}/${dialog.parentGroupId ?? ''}`
            : 'new-closed'
        }
        open={dialog?.kind === 'new'}
        onOpenChange={(open) => {
          if (!open) closeDialog()
        }}
        groups={all}
        initialUnitId={dialog?.kind === 'new' ? dialog.unitId : undefined}
        initialParentGroupId={dialog?.kind === 'new' ? dialog.parentGroupId : undefined}
        onCreated={select}
      />
      {dialog?.kind === 'rename' ? (
        <RenameGroupDialog
          open
          onOpenChange={(open) => {
            if (!open) closeDialog()
          }}
          groupId={dialog.group.id}
          currentName={dialog.group.name}
        />
      ) : undefined}
      {dialog?.kind === 'delete' ? (
        <DeleteGroupDialog
          open
          onOpenChange={(open) => {
            if (!open) closeDialog()
          }}
          group={dialog.group}
          nestedGroupCount={all.filter((group) => group.parentGroupId === dialog.group.id).length}
          onDeleted={() => {
            select(undefined)
          }}
        />
      ) : undefined}
    </AppPage>
  )
}
