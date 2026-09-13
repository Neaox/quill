import { getRouteApi } from '@tanstack/react-router'

import { Button, Callout } from '@quill/ui'

import {
  useLoadedWorkspace,
  useLoadedWorkspaceSettings,
  useSaveWorkspaceSettings,
  type LayoutSettings,
  type WorkspaceSettingsDocument,
} from '../../lib/api/index.ts'
import { ShellActions } from '../workspaces/shell-slots.tsx'
import { describeLayout, LayoutChoices } from './layout-choices.tsx'
import { SettingsFormFeedback } from './settings-form-feedback.tsx'
import { UnsavedChangesGuard } from './unsaved-changes-guard.tsx'
import { useSettingsDraft } from './use-settings-draft.ts'

const routeApi = getRouteApi('/_authenticated/w/$workspaceSlug/settings')

/**
 * A workspace's own settings: its layout, and nothing else (ADR-028's
 * amendment).
 *
 * Identity — the theme, the type pairing, the seeds — is the organisation's
 * and a workspace may not change it, so it is not offered here and not
 * explained away either: what this screen says is what this workspace
 * decides. Layout is the one thing it owns, and it owns it *unless* the
 * organisation locked it.
 *
 * The lock is shown, not hidden. A locked workspace sees the arrangement it
 * has, the organisation named as the thing that decided it, and the radio
 * groups disabled — which is more use than an empty panel, and is the rule in
 * `docs/design/feedback.md`: a control that cannot act is disabled with its
 * reason beside it, never silently inert. The same is true when the lock is
 * turned on *while* this page is open: the server answers `409
 * workspace_layout_locked` and that becomes a state on the page.
 *
 * "Inherit" is the **absence** of `layout` in the document, not a copy of the
 * organisation's values, so a workspace that inherits keeps inheriting when
 * the organisation's default changes.
 */
export function WorkspaceSettingsPage() {
  const { workspaceSlug } = routeApi.useParams()
  const workspace = useLoadedWorkspace(workspaceSlug).data
  const loaded = useLoadedWorkspaceSettings(workspaceSlug)
  const save = useSaveWorkspaceSettings(workspaceSlug)
  const draft = useSettingsDraft<WorkspaceSettingsDocument>(
    loaded.data.settings,
    loaded.data.revision,
  )

  const settings = draft.value
  const server = loaded.data.settings
  const effective = loaded.data.effective
  const locked = effective.layoutLocked
  const overriding = settings.layout !== undefined

  function setOverride(layout: LayoutSettings | undefined) {
    if (layout === undefined) {
      const next = { ...settings }
      delete next.layout
      draft.change(next)
      return
    }
    draft.change({ ...settings, layout })
  }

  function submit() {
    save.mutate(
      { settings, expectedRevision: draft.revision, changeNote: 'Workspace layout' },
      { onSuccess: (saved) => draft.reset(saved.settings, saved.revision) },
    )
  }

  return (
    <div className="flex flex-col gap-6 px-8 py-8">
      <UnsavedChangesGuard dirty={draft.dirty} what="workspace layout" />
      <ShellActions>
        <Button
          size="sm"
          loading={save.isPending}
          disabled={locked || !draft.dirty}
          onClick={submit}
        >
          Save
        </Button>
      </ShellActions>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {workspace.name} settings
        </h1>
        <p className="mt-1 max-w-(--layout-content) text-sm text-muted">
          How this workspace is arranged. Its identity — the theme, the type, the colours — belongs
          to the organisation and is the same everywhere.
        </p>
      </div>

      {/*
       * Save is disabled until something changes, and a disabled control
       * carries its reason (`docs/design/feedback.md`). When the organisation
       * has locked layout the reason is the notice below instead, which says
       * more than this would.
       */}
      {locked || draft.dirty ? undefined : (
        <p className="text-xs text-muted">Nothing has changed yet, so there is nothing to save.</p>
      )}

      {locked ? (
        <Callout tone="info" title="The organisation decides the layout">
          Every workspace here uses the same arrangement: {describeLayout(effective.layout)}. An
          instance administrator can unlock it in the organisation’s layout settings.
        </Callout>
      ) : undefined}

      <SettingsFormFeedback
        error={save.error}
        noun="workspace settings"
        conflictSummary={
          <ul>
            <li>
              {server.layout === undefined
                ? 'Inheriting the organisation’s default'
                : describeLayout(server.layout)}
            </li>
          </ul>
        }
        onReload={() => {
          draft.reset(server, loaded.data.revision)
          save.reset()
        }}
        onReplace={() => {
          draft.adoptRevision(loaded.data.revision)
          save.reset()
        }}
      />

      <fieldset className="flex flex-col gap-2 border-0 p-0" disabled={locked}>
        <legend className="text-sm font-medium text-foreground">Where the layout comes from</legend>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="radio"
            name="workspace-layout-source"
            className="size-4 accent-accent"
            checked={!overriding}
            onChange={() => {
              setOverride(undefined)
            }}
          />
          Follow the organisation’s default
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="radio"
            name="workspace-layout-source"
            className="size-4 accent-accent"
            checked={overriding}
            onChange={() => {
              setOverride(effective.layout)
            }}
          />
          Choose for this workspace
        </label>
        <p className="text-xs text-muted">
          {overriding
            ? 'This workspace keeps its own arrangement when the organisation changes its default.'
            : `Today that is ${describeLayout(effective.layout)}.`}
        </p>
      </fieldset>

      {overriding && settings.layout !== undefined ? (
        <LayoutChoices
          groupPrefix="workspace-layout"
          layout={settings.layout}
          disabled={locked}
          onLayoutChange={setOverride}
        />
      ) : undefined}
    </div>
  )
}
