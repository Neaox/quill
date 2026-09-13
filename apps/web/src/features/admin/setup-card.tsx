import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { Button, Callout, textLinkClassName } from '@quill/ui'

import { useUnits, useWorkspaceList } from '../../lib/api/index.ts'
import { CreateUnitDialog } from './unit-dialogs.tsx'
import { CreateWorkspaceDialog } from './workspace-dialogs.tsx'

/**
 * The administrator's set-up card on the signed-in home (`docs/design/home.md`:
 * "Admins additionally see a short set-up card until it is done").
 *
 * It carries the actual first two steps rather than describing them — create a
 * unit, then a workspace inside it — and it takes itself away: once a
 * workspace exists there is nothing here to do, and the card is not rendered.
 * Rendered only for an instance administrator — `GET /api/units` is
 * admin-only, so a non-administrator must not even ask — which is why the
 * check is the caller's rather than an early return inside.
 */
export function SetupCard() {
  const units = useUnits(undefined)
  const workspaces = useWorkspaceList()
  const [creatingUnit, setCreatingUnit] = useState(false)
  const [workspaceInUnit, setWorkspaceInUnit] = useState<
    { readonly id: string; readonly name: string } | undefined
  >(undefined)

  // Nothing loaded yet, or the instance already has a workspace: either way
  // there is nothing to walk anybody through.
  if (units.data === undefined || (workspaces.data ?? []).length > 0) return undefined

  const firstUnit = units.data[0]

  return (
    <section aria-labelledby="set-up-heading" className="flex flex-col gap-3">
      <h2 id="set-up-heading" className="text-sm font-semibold tracking-tight text-foreground">
        Set up your organisation
      </h2>
      <Callout tone="info">
        {firstUnit === undefined
          ? 'Nothing exists yet. Start with a unit — your company, or the first department — and put a workspace in it.'
          : `You have ${units.data.length === 1 ? 'a unit' : 'units'} but no workspace. A workspace is where a team actually writes.`}
      </Callout>
      <div className="flex flex-wrap items-center gap-2">
        {firstUnit === undefined ? (
          <Button
            onClick={() => {
              setCreatingUnit(true)
            }}
          >
            Create a unit
          </Button>
        ) : (
          <Button
            onClick={() => {
              setWorkspaceInUnit({ id: firstUnit.id, name: firstUnit.name })
            }}
          >
            Create a workspace
          </Button>
        )}
        <Link to="/admin/organisation" className={textLinkClassName({ size: 'xs' })}>
          Manage the organisation
        </Link>
      </div>

      <CreateUnitDialog
        open={creatingUnit}
        onOpenChange={setCreatingUnit}
        onCreated={(unitId) => {
          // Straight on to the step that follows, with the unit just made
          // already chosen: the card is a path, not a list of links.
          setWorkspaceInUnit({ id: unitId, name: 'your new unit' })
        }}
      />
      {workspaceInUnit === undefined ? undefined : (
        <CreateWorkspaceDialog
          open
          onOpenChange={(open) => {
            if (!open) setWorkspaceInUnit(undefined)
          }}
          unitId={workspaceInUnit.id}
          unitName={workspaceInUnit.name}
        />
      )}
    </section>
  )
}
