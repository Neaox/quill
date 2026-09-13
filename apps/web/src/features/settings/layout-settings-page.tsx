import { Button } from '@quill/ui'

import {
  useLoadedOrganisationSettings,
  useSaveOrganisationSettings,
  type OrganisationSettings,
} from '../../lib/api/index.ts'
import { describeLayout, LayoutChoices } from './layout-choices.tsx'
import { SettingsActions, SettingsSection } from './settings-frame.tsx'
import { SettingsFormFeedback } from './settings-form-feedback.tsx'
import { ToggleField } from './toggle-field.tsx'
import { UnsavedChangesGuard } from './unsaved-changes-guard.tsx'
import { useSettingsDraft } from './use-settings-draft.ts'

/**
 * The organisation's default layout, and whether a workspace may depart from
 * it (ADR-028's amendment).
 *
 * Layout is the one row of the "who decides what" table the organisation only
 * *sets the default* for: a workspace owns it. This screen is therefore two
 * separate decisions that are easy to confuse, so they are separated on
 * screen: what a workspace starts with, and whether it may change it. Turning
 * the lock on does not change any workspace's arrangement — it refuses the
 * next change to one.
 *
 * TODO(M3): the application shell still reads its signature variants from the
 * theme document rather than from these settings
 * (`features/workspaces/workspace-layout.tsx`). ADR-028's amendment renames
 * `theme.variants` to `layout` and moves the attributes to workspace level;
 * that rename is a branch of its own, and until it lands this screen writes
 * `layout` in the settings document — which is what the API and the workspace
 * settings screen already read — while the shell keeps rendering the default
 * identity's variants. The sentence below says so on screen.
 */
export function LayoutSettingsPage() {
  const loaded = useLoadedOrganisationSettings()
  const save = useSaveOrganisationSettings()
  const draft = useSettingsDraft<OrganisationSettings>(loaded.data.settings, loaded.data.revision)

  const settings = draft.value
  const server = loaded.data.settings

  function submit() {
    save.mutate(
      { settings, expectedRevision: draft.revision, changeNote: 'Layout default' },
      { onSuccess: (saved) => draft.reset(saved.settings, saved.revision) },
    )
  }

  return (
    <>
      <UnsavedChangesGuard dirty={draft.dirty} what="layout" />
      <SettingsActions>
        <Button size="sm" loading={save.isPending} disabled={!draft.dirty} onClick={submit}>
          Save
        </Button>
      </SettingsActions>

      <SettingsSection
        title="Layout"
        description="How a workspace is arranged. This is the arrangement every workspace starts with; each one may choose its own unless you lock it."
      >
        {draft.dirty ? undefined : (
          <p className="text-xs text-muted">
            Nothing has changed yet, so there is nothing to save.
          </p>
        )}

        <SettingsFormFeedback
          error={save.error}
          noun="layout settings"
          conflictSummary={
            <ul>
              <li>{describeLayout(server.layout.default)}</li>
              <li>
                Workspaces may {server.layout.locked ? 'not ' : ''}choose their own arrangement.
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

        <p className="text-xs text-muted">
          Saved here now, and read by workspace settings. The application shell still draws the
          built-in identity’s arrangement until the rename ADR-028’s amendment schedules lands.
        </p>

        <LayoutChoices
          groupPrefix="organisation-layout"
          layout={settings.layout.default}
          onLayoutChange={(layout) => {
            draft.change({ ...settings, layout: { ...settings.layout, default: layout } })
          }}
        />
      </SettingsSection>

      <SettingsSection
        title="Who decides"
        description="Identity is always the organisation’s. Layout is the workspace’s, unless you take it back."
        level={2}
      >
        <ToggleField
          label="Every workspace uses this arrangement"
          description="Locked, a workspace’s own layout setting is refused and it is told who decided. Unlocked, this is only what a workspace starts with."
          checked={settings.layout.locked}
          onCheckedChange={(locked) => {
            draft.change({ ...settings, layout: { ...settings.layout, locked } })
          }}
        />
      </SettingsSection>
    </>
  )
}
