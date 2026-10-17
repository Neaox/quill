import { Link } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'

import { BRAND } from '@quill/brand'
import { Button, CheckIcon, buttonClassName, tv } from '@quill/ui'

import { useOrganisationSettings, useUnits } from '../../lib/api/index.ts'
import type { WorkspaceSummaryDto } from '../../lib/api/types.ts'
import { workspaceReference } from '../../lib/routing/document-reference.ts'
import { CreateUnitDialog } from '../admin/unit-dialogs.tsx'
import { CreateWorkspaceDialog } from '../admin/workspace-dialogs.tsx'

export const setupChecklistStyles = tv({
  slots: {
    root: 'flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4 shadow-raised sm:p-5',
    // "Hide" sits on the title's baseline, not on the block's top edge.
    head: 'flex items-baseline justify-between gap-4',
    title: 'text-base font-semibold tracking-tight text-foreground',
    progress: 'mt-0.5 text-xs text-muted tabular-nums',
    list: 'flex flex-col',
    step: [
      'flex flex-col gap-3 border-t border-border py-3.5 first:border-t-0 first:pt-0',
      'last:pb-0 sm:flex-row sm:items-center sm:justify-between',
    ],
    stepBody: 'flex min-w-0 items-start gap-3',
    marker: [
      'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
      'border border-border-strong text-2xs font-semibold text-muted tabular-nums',
      // A finished step is the one place the accent appears here.
      'data-done:border-transparent data-done:bg-accent data-done:text-accent-foreground',
    ],
    stepTitle: 'text-sm font-medium text-foreground in-data-done:text-foreground-soft',
    stepNote: 'mt-0.5 text-xs leading-relaxed text-muted',
    actions: 'flex shrink-0 flex-wrap gap-2 ps-8 sm:ps-0',
  },
})

/** What the checklist needs to know about the instance, already answered. */
export interface SetupFacts {
  /** The organisation has been given a name of its own, which means somebody has been through settings. */
  readonly named: boolean
  readonly hasWorkspace: boolean
  readonly anyPublished: boolean
}

export type SetupStepId = 'identity' | 'workspace' | 'publish'

export interface SetupStep {
  readonly id: SetupStepId
  readonly title: string
  readonly note: string
  readonly done: boolean
}

/**
 * The three steps from an empty instance to one people can read, in order.
 *
 * Each is answered from what the API already says rather than from anything
 * remembered: a name other than the product's, a workspace, a published
 * document. "Invite people" and "sign-in" are not steps because nothing can
 * tell when they are done; they are reached from the person menu instead.
 */
export function setupSteps({ named, hasWorkspace, anyPublished }: SetupFacts): SetupStep[] {
  return [
    {
      id: 'identity',
      title: 'Name your organisation and choose its theme',
      note: 'The name heads every page, and the theme is how your documentation looks to everyone.',
      done: named,
    },
    {
      id: 'workspace',
      title: 'Create the first workspace',
      note: 'A unit — your company, or a team in it — holds workspaces, and a workspace is where people write.',
      done: hasWorkspace,
    },
    {
      id: 'publish',
      title: 'Publish the first document',
      note: 'Readers see what is published. Drafts stay with the people writing them.',
      done: anyPublished,
    },
  ]
}

/** Where "hide the checklist" is remembered: per browser, a convenience rather than a setting. */
const HIDDEN_KEY = 'home-setup-hidden'

function readHidden(): boolean {
  try {
    return globalThis.localStorage.getItem(HIDDEN_KEY) === 'true'
  } catch {
    return false
  }
}

function writeHidden(): void {
  try {
    globalThis.localStorage.setItem(HIDDEN_KEY, 'true')
  } catch {
    // Hidden for this visit even when it cannot be remembered.
  }
}

export interface SetupChecklistState {
  readonly steps: readonly SetupStep[]
  readonly done: number
  /** Whether the checklist is on the page: answered, unfinished, and not hidden. */
  readonly visible: boolean
  readonly hide: () => void
}

/**
 * Where the checklist stands, for the page as well as for the checklist: the
 * page drops its own "no workspaces" notice while the checklist is already
 * saying so, and shows it again once the checklist is hidden or done.
 */
export function useSetupChecklist(
  workspaces: readonly WorkspaceSummaryDto[],
  anyPublished: boolean,
  /** Whether `anyPublished` is an answer yet, so the last step is not shown undone by default. */
  published: 'known' | 'unknown',
): SetupChecklistState {
  const settings = useOrganisationSettings()
  const [hidden, setHidden] = useState(readHidden)

  const name = settings.data?.settings.name
  const steps = setupSteps({
    named: name !== undefined && name.trim() !== '' && name !== BRAND.name,
    hasWorkspace: workspaces.length > 0,
    anyPublished,
  })
  const done = steps.filter((step) => step.done).length

  return {
    steps,
    done,
    // Not until the settings have answered, so a finished step never flashes
    // as unfinished; and not at all once everything is done or it was hidden.
    visible: settings.data !== undefined && published === 'known' && !hidden && done < steps.length,
    hide: () => {
      writeHidden()
      setHidden(true)
    },
  }
}

export interface SetupChecklistProps {
  readonly setup: SetupChecklistState
  readonly workspaces: readonly WorkspaceSummaryDto[]
  /** Where the checklist sits on the page that holds it. */
  readonly className?: string | undefined
}

/**
 * The administrator's set-up checklist on the signed-in home
 * (`docs/design/home.md`: "Admins additionally see a short set-up card until
 * it is done").
 *
 * It carries the actual steps rather than describing them — the settings to
 * open, the unit and workspace to create, the workspace to write in — and it
 * takes itself away: finished, it is not rendered, and an administrator who
 * would rather not see it can hide it. Rendered only for an instance
 * administrator, because `GET /api/units` is admin-only and a
 * non-administrator must not even ask; the check is the caller's.
 */
export function SetupChecklist({ setup, workspaces, className }: SetupChecklistProps) {
  const { steps, done, visible, hide } = setup
  const styles = setupChecklistStyles()

  if (!visible) return undefined

  return (
    <section aria-labelledby="set-up-heading" className={styles.root({ className })}>
      <div className={styles.head()}>
        <div>
          <h2 id="set-up-heading" className={styles.title()}>
            Set up your organisation
          </h2>
          <p className={styles.progress()}>
            {done} of {steps.length} done
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={hide}>
          Hide
        </Button>
      </div>

      <ol className={styles.list()}>
        {steps.map((step, index) => (
          <li key={step.id} data-done={step.done ? '' : undefined} className={styles.step()}>
            <div className={styles.stepBody()}>
              <span
                aria-hidden="true"
                data-done={step.done ? '' : undefined}
                className={styles.marker()}
              >
                {step.done ? <CheckIcon className="size-3" /> : index + 1}
              </span>
              <div className="min-w-0">
                <p className={styles.stepTitle()}>
                  {step.title}
                  {step.done ? <span className="sr-only"> (done)</span> : undefined}
                </p>
                {step.done ? undefined : <p className={styles.stepNote()}>{step.note}</p>}
              </div>
            </div>
            {step.done ? undefined : (
              <div className={styles.actions()}>
                <StepActions id={step.id} workspaces={workspaces} />
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

function StepActions({
  id,
  workspaces,
}: {
  readonly id: SetupStepId
  readonly workspaces: readonly WorkspaceSummaryDto[]
}): ReactNode {
  switch (id) {
    case 'identity':
      return (
        <>
          <Link
            to="/admin/settings/organisation"
            className={buttonClassName({ variant: 'secondary', size: 'sm' })}
          >
            Organisation settings
          </Link>
          <Link
            to="/admin/settings/theme"
            className={buttonClassName({ variant: 'secondary', size: 'sm' })}
          >
            Theme
          </Link>
        </>
      )
    case 'workspace':
      return <CreateFirstWorkspace />
    case 'publish': {
      const first = workspaces[0]
      // The step after a workspace exists, and only actionable then: a
      // control with nowhere to go is not rendered (`docs/design/feedback.md`).
      return first === undefined ? undefined : (
        <Link
          to="/w/$workspaceSlug"
          params={{ workspaceSlug: workspaceReference(first) }}
          className={buttonClassName({ variant: 'secondary', size: 'sm' })}
        >
          Open {first.name}
        </Link>
      )
    }
  }
}

/** Create a unit, then straight on to a workspace inside it: the step is a path, not two links. */
function CreateFirstWorkspace() {
  const units = useUnits(undefined)
  const [creatingUnit, setCreatingUnit] = useState(false)
  const [workspaceInUnit, setWorkspaceInUnit] = useState<
    { readonly id: string; readonly name: string } | undefined
  >(undefined)

  if (units.data === undefined) return undefined
  const firstUnit = units.data[0]

  return (
    <>
      {firstUnit === undefined ? (
        <Button
          size="sm"
          onClick={() => {
            setCreatingUnit(true)
          }}
        >
          Create a unit
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={() => {
            setWorkspaceInUnit({ id: firstUnit.id, name: firstUnit.name })
          }}
        >
          Create a workspace
        </Button>
      )}

      <CreateUnitDialog
        open={creatingUnit}
        onOpenChange={setCreatingUnit}
        onCreated={(unitId) => {
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
    </>
  )
}
