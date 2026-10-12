import { useNavigate } from '@tanstack/react-router'
import { useId } from 'react'

import { tv } from '@quill/ui'

import { useWorkspaceList } from '../../lib/api/index.ts'

/*
 * The switcher is the sidebar's title: the workspace's name in ink at the
 * weight of a heading, which happens to open a list. It wears a control's
 * outline only when a pointer is on it, so the column reads as a page with a
 * title rather than a form with a field at the top.
 */
export const workspaceSwitcherStyles = tv({
  slots: {
    root: 'flex min-w-0 grow items-center',
    name: 'truncate px-2 text-sm font-semibold text-foreground',
    select: [
      'focus-ring h-8 w-full min-w-0 cursor-pointer rounded-md border border-transparent',
      'bg-transparent px-1.5 text-sm font-semibold text-foreground',
      'transition-[border-color,background-color] ease-standard',
      'hover:border-border hover:bg-surface',
    ],
  },
})

export interface WorkspaceSwitcherProps {
  readonly activeWorkspaceId: string
  readonly activeWorkspaceName: string
}

/**
 * Switches between the workspaces this person can see, from `GET
 * /api/workspaces` — the same list the home page groups by unit, so the
 * switcher can never offer a workspace that home does not, or miss one it
 * does.
 *
 * It stands where the workspace's name would otherwise be, at the head of the
 * navigation sidebar, and *is* that name when there is only one workspace to
 * have: the control appears exactly where a person looks to find out which
 * workspace they are in, and the header bar does not say it twice.
 *
 * A native `<select>` rather than a custom menu: `@quill/ui` does not yet
 * export a menu/listbox primitive, and a select is fully keyboard-operable and
 * announced correctly with no extra work.
 *
 * TODO(ADR-019): replace with a `Select`/`Combobox` primitive from `@quill/ui`
 * once one exists, per `docs/architecture/styling.md`'s rule of reaching for
 * the closest primitive and leaving a tracked note — there is no closer one
 * today.
 */
export function WorkspaceSwitcher({
  activeWorkspaceId,
  activeWorkspaceName,
}: WorkspaceSwitcherProps) {
  const workspaces = useWorkspaceList()
  const navigate = useNavigate()
  const id = useId()
  const styles = workspaceSwitcherStyles()

  const listed = workspaces.data ?? []
  // The active workspace is always offered, even before the list has arrived
  // (a fresh session opening a workspace link directly).
  const options = listed.some((workspace) => workspace.id === activeWorkspaceId)
    ? listed.map((workspace) => ({ id: workspace.id, name: workspace.name }))
    : [{ id: activeWorkspaceId, name: activeWorkspaceName }, ...listed]

  // One workspace is not a choice: the name is a heading, not a control.
  if (options.length <= 1) {
    return <p className={styles.name()}>{activeWorkspaceName}</p>
  }

  return (
    <div className={styles.root()}>
      <label htmlFor={id} className="sr-only">
        Switch workspace
      </label>
      <select
        id={id}
        value={activeWorkspaceId}
        onChange={(event) => {
          void navigate({ to: '/w/$workspaceSlug', params: { workspaceSlug: event.target.value } })
        }}
        className={styles.select()}
      >
        {options.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
    </div>
  )
}
