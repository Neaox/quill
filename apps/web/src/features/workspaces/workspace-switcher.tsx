import { useNavigate } from '@tanstack/react-router'
import { useId } from 'react'

import { useWorkspaceList } from '../../lib/api/index.ts'

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

  const listed = workspaces.data ?? []
  // The active workspace is always offered, even before the list has arrived
  // (a fresh session opening a workspace link directly).
  const options = listed.some((workspace) => workspace.id === activeWorkspaceId)
    ? listed.map((workspace) => ({ id: workspace.id, name: workspace.name }))
    : [{ id: activeWorkspaceId, name: activeWorkspaceName }, ...listed]

  // One workspace is not a choice: the name is a heading, not a control.
  if (options.length <= 1) {
    return <p className="meta truncate text-muted">{activeWorkspaceName}</p>
  }

  return (
    <div className="flex min-w-0 grow items-center gap-1.5">
      <label htmlFor={id} className="sr-only">
        Switch workspace
      </label>
      <select
        id={id}
        value={activeWorkspaceId}
        onChange={(event) => {
          void navigate({ to: '/w/$workspaceSlug', params: { workspaceSlug: event.target.value } })
        }}
        className="focus-ring h-7 w-full min-w-0 rounded-md border border-border bg-surface-raised px-1.5 text-2xs font-medium text-foreground hover:border-border-strong"
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
