import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { Button, buttonClassName, Callout, Menu, Spinner, tv } from '@quill/ui'

import {
  useUnits,
  useWorkspaceList,
  type UnitDto,
  type WorkspaceSummaryDto,
} from '../../lib/api/index.ts'
import { workspaceReference } from '../../lib/routing/document-reference.ts'
import { AppPage } from '../layout/app-page.tsx'
import { CreateUnitDialog, DeleteUnitDialog, RenameUnitDialog } from './unit-dialogs.tsx'
import {
  CreateWorkspaceDialog,
  DeleteWorkspaceDialog,
  RenameWorkspaceDialog,
} from './workspace-dialogs.tsx'

export const organisationPageStyles = tv({
  slots: {
    branch: 'flex flex-col gap-1',
    row: 'group/row flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface',
    name: 'truncate text-sm font-medium text-foreground',
    kind: 'meta shrink-0 text-muted',
    spacer: 'grow',
    controls: 'flex shrink-0 items-center gap-1',
    children: 'ms-3 flex flex-col gap-1 border-s border-border ps-3',
    workspaceLink: 'focus-ring truncate rounded-sm text-sm text-foreground hover:text-accent',
  },
})

/** Which dialog is open, and about what. One at a time, for the whole page. */
type OrganisationDialog =
  | { readonly kind: 'new-unit'; readonly parentId?: string; readonly parentName?: string }
  | { readonly kind: 'rename-unit'; readonly id: string; readonly name: string }
  | {
      readonly kind: 'delete-unit'
      readonly id: string
      readonly name: string
      readonly workspaceCount: number
      readonly childUnitCount: number
    }
  | { readonly kind: 'new-workspace'; readonly unitId: string; readonly unitName: string }
  | { readonly kind: 'rename-workspace'; readonly id: string; readonly name: string }
  | { readonly kind: 'delete-workspace'; readonly id: string; readonly name: string }

interface BranchProps {
  readonly unit: UnitDto
  readonly workspaces: readonly WorkspaceSummaryDto[]
  readonly onOpenDialog: (dialog: OrganisationDialog) => void
}

/**
 * One unit, its workspaces, and the units under it.
 *
 * Each branch asks for its own children (`GET /api/units?parentId=`), which is
 * one request per unit: the unit tree is an organisation chart, not a document
 * tree, so it is tens of rows rather than thousands, and a request per row is
 * cheaper to reason about than a route that does not exist yet. The workspaces
 * come from one list for the whole page, because `GET /api/workspaces` already
 * carries each one's `unitId`.
 */
function UnitBranch({ unit, workspaces, onOpenDialog }: BranchProps) {
  const children = useUnits(unit.id)
  const styles = organisationPageStyles()
  const mine = workspaces.filter((workspace) => workspace.unitId === unit.id)
  const childUnits = children.data ?? []

  return (
    <li className={styles.branch()}>
      <div className={styles.row()}>
        <span className={styles.name()}>{unit.name}</span>
        <span className={styles.kind()}>{unit.label}</span>
        <span className={styles.spacer()} />
        <div className={styles.controls()}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onOpenDialog({ kind: 'new-workspace', unitId: unit.id, unitName: unit.name })
            }}
          >
            New workspace
          </Button>
          <Menu
            label={unit.name}
            items={[
              {
                label: 'New unit inside…',
                onSelect: () => {
                  onOpenDialog({ kind: 'new-unit', parentId: unit.id, parentName: unit.name })
                },
              },
              {
                label: 'Rename…',
                onSelect: () => {
                  onOpenDialog({ kind: 'rename-unit', id: unit.id, name: unit.name })
                },
              },
              {
                label: 'Delete…',
                onSelect: () => {
                  onOpenDialog({
                    kind: 'delete-unit',
                    id: unit.id,
                    name: unit.name,
                    workspaceCount: mine.length,
                    childUnitCount: childUnits.length,
                  })
                },
              },
            ]}
          />
        </div>
      </div>

      {mine.length === 0 && childUnits.length === 0 ? undefined : (
        <ul className={styles.children()}>
          {mine.map((workspace) => (
            <li key={workspace.id} className={styles.row()}>
              <Link
                to="/w/$workspaceSlug"
                params={{ workspaceSlug: workspaceReference(workspace) }}
                className={styles.workspaceLink()}
              >
                {workspace.name}
              </Link>
              <span className={styles.kind()}>workspace</span>
              <span className={styles.spacer()} />
              <Menu
                label={workspace.name}
                items={[
                  {
                    label: 'Rename…',
                    onSelect: () => {
                      onOpenDialog({
                        kind: 'rename-workspace',
                        id: workspace.id,
                        name: workspace.name,
                      })
                    },
                  },
                  {
                    label: 'Delete…',
                    onSelect: () => {
                      onOpenDialog({
                        kind: 'delete-workspace',
                        id: workspace.id,
                        name: workspace.name,
                      })
                    },
                  },
                ]}
              />
            </li>
          ))}
          {childUnits.map((child) => (
            <UnitBranch
              key={child.id}
              unit={child}
              workspaces={workspaces}
              onOpenDialog={onOpenDialog}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * The organisation: units, the workspaces inside them, and every write the M2
 * API offers for both (use cases 2 and 3).
 *
 * Reached only by an instance administrator — the route turns anyone else
 * away before this renders — and deliberately plain: a tree of names, a
 * primary action per row, and everything destructive behind a dialog that says
 * what is inside before it will let go of it.
 */
export function OrganisationPage() {
  const units = useUnits()
  const workspaces = useWorkspaceList()
  const [dialog, setDialog] = useState<OrganisationDialog | undefined>(undefined)

  const roots = units.data ?? []
  const allWorkspaces = workspaces.data ?? []

  function closeDialog() {
    setDialog(undefined)
  }

  return (
    <AppPage
      actions={
        <>
          {/*
           * The other half of instance administration. Units and workspaces
           * are *what* the organisation is; settings are what it looks like
           * and what it allows (ADR-034), and both are reached from the same
           * bar rather than from two places that do not know about each other.
           */}
          <Link to="/admin/settings" className={buttonClassName({ size: 'sm', variant: 'ghost' })}>
            Settings
          </Link>
          <Button
            size="sm"
            onClick={() => {
              setDialog({ kind: 'new-unit' })
            }}
          >
            New unit
          </Button>
        </>
      }
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Organisation</h1>
        <p className="mt-1 text-sm text-muted">
          Units are the private branches of your organisation; workspaces are where teams write.
          Both live here.
        </p>
      </div>

      {units.isPending ? (
        <p aria-busy="true" className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading the organisation
        </p>
      ) : units.isError ? (
        <Callout tone="danger" title="Couldn't load the organisation">
          Reload the page to try again.
        </Callout>
      ) : roots.length === 0 ? (
        <Callout tone="info" title="Nothing here yet">
          Start with a unit — your company, or the first department. Workspaces go inside it.
        </Callout>
      ) : (
        <ul aria-label="Units" className="flex flex-col gap-1">
          {roots.map((unit) => (
            <UnitBranch
              key={unit.id}
              unit={unit}
              workspaces={allWorkspaces}
              onOpenDialog={setDialog}
            />
          ))}
        </ul>
      )}

      <CreateUnitDialog
        key={dialog?.kind === 'new-unit' ? (dialog.parentId ?? 'root') : 'new-unit-closed'}
        open={dialog?.kind === 'new-unit'}
        onOpenChange={(open) => {
          if (!open) closeDialog()
        }}
        {...(dialog?.kind === 'new-unit' && dialog.parentId !== undefined
          ? { parentId: dialog.parentId, parentName: dialog.parentName }
          : {})}
      />
      {dialog?.kind === 'rename-unit' ? (
        <RenameUnitDialog
          open
          onOpenChange={(open) => {
            if (!open) closeDialog()
          }}
          unitId={dialog.id}
          currentName={dialog.name}
        />
      ) : undefined}
      {dialog?.kind === 'delete-unit' ? (
        <DeleteUnitDialog
          open
          onOpenChange={(open) => {
            if (!open) closeDialog()
          }}
          unitId={dialog.id}
          name={dialog.name}
          workspaceCount={dialog.workspaceCount}
          childUnitCount={dialog.childUnitCount}
        />
      ) : undefined}
      {dialog?.kind === 'new-workspace' ? (
        <CreateWorkspaceDialog
          open
          onOpenChange={(open) => {
            if (!open) closeDialog()
          }}
          unitId={dialog.unitId}
          unitName={dialog.unitName}
          openOnCreate={false}
        />
      ) : undefined}
      {dialog?.kind === 'rename-workspace' ? (
        <RenameWorkspaceDialog
          open
          onOpenChange={(open) => {
            if (!open) closeDialog()
          }}
          workspaceId={dialog.id}
          currentName={dialog.name}
        />
      ) : undefined}
      {dialog?.kind === 'delete-workspace' ? (
        <DeleteWorkspaceDialog
          open
          onOpenChange={(open) => {
            if (!open) closeDialog()
          }}
          workspaceId={dialog.id}
          name={dialog.name}
        />
      ) : undefined}
    </AppPage>
  )
}
