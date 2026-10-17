import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'

import { textLinkClassName, tv } from '@quill/ui'
import { generateTheme } from '@quill/theme'

import {
  useLoadedOrganisationSettings,
  useOrganisationEmoji,
  useSaveOrganisationSettings,
  type OrganisationSettings,
} from '../../lib/api/index.ts'
import { COMPACT_EDITOR_QUERY, useMediaQuery } from '../layout/use-media-query.ts'
import { EmojiEditor } from './emoji-editor.tsx'
import { LabelsEditor } from './labels-editor.tsx'
import { SettingsActionBar } from './settings-action-bar.tsx'
import { SettingsActions, SettingsSection } from './settings-frame.tsx'
import { SettingsFormFeedback } from './settings-form-feedback.tsx'
import { SettingsSaveButton } from './settings-save-button.tsx'
import { forkedIfBuiltin, withOptional } from './theme-fork.ts'
import { UnsavedChangesGuard } from './unsaved-changes-guard.tsx'
import { useSettingsDraft } from './use-settings-draft.ts'

const pageStyles = tv({
  slots: {
    // Side by side once there is room for two editors at a field's width;
    // one column, labels first, below that.
    columns: 'grid grid-cols-[minmax(0,1fr)] items-start gap-10 @4xl:grid-cols-2',
    status: 'text-xs text-muted',
  },
})

/** Names in a conflict's summary, or a word for none. */
function listed(names: readonly string[]): string {
  return names.length === 0 ? 'none' : names.join(', ')
}

/**
 * The organisation's labels (ADR-037) and its own emoji (ADR-038), on a
 * screen of their own so the theme editor stays about colour, type and shape.
 *
 * The two live in different parts of one settings document — labels in the
 * theme, because a label's colour is generated with the palette and checked
 * by the theme doctor; emoji beside it, because an emoji is an image and not
 * a colour — and they are edited together because a label leads with the
 * emoji of its name. One draft of the whole document, one Save, one revision:
 * a conflict with somebody saving the theme at the same moment is caught by
 * the same compare-and-swap, and resolved with the same notice, as on Theme.
 *
 * A label is a change to the theme, so the first one forks a built-in exactly
 * as a lever on Theme does (`theme-fork.ts`). The palettes are generated here
 * too, for the pills' previews; the doctor's verdict on them is on Theme.
 */
export function LabelsAndEmojiPage() {
  const compact = useMediaQuery(COMPACT_EDITOR_QUERY)
  const loaded = useLoadedOrganisationSettings()
  const save = useSaveOrganisationSettings()
  const draft = useSettingsDraft<OrganisationSettings>(loaded.data.settings, loaded.data.revision)
  const organisationEmoji = useOrganisationEmoji()
  const styles = pageStyles()

  const settings = draft.value
  const server = loaded.data.settings
  const theme = settings.theme
  const enforcement = settings.policies.contrastEnforcement

  const generated = useMemo(
    () => generateTheme(theme, { textContrast: enforcement }),
    [theme, enforcement],
  )
  const served = useMemo(
    () =>
      new Map(
        [...(organisationEmoji?.custom ?? [])].map(([name, { src, still }]) => [
          name,
          { src, still },
        ]),
      ),
    [organisationEmoji],
  )

  function submit() {
    save.mutate(
      { settings, expectedRevision: draft.revision, changeNote: 'Labels and emoji' },
      { onSuccess: (saved) => draft.reset(saved.settings, saved.revision) },
    )
  }

  const saveButton = (
    <SettingsSaveButton
      compact={compact}
      dirty={draft.dirty}
      pending={save.isPending}
      onSave={submit}
    />
  )

  return (
    <>
      <UnsavedChangesGuard dirty={draft.dirty} what="labels and emoji" />
      {compact ? undefined : <SettingsActions>{saveButton}</SettingsActions>}

      <SettingsSection
        title="Labels and emoji"
        description="The coloured pills and the images your documents can name. Every workspace shares them."
        wide
      >
        {draft.dirty ? undefined : (
          <p className={styles.status()}>Nothing has changed yet, so there is nothing to save.</p>
        )}

        <SettingsFormFeedback
          error={save.error}
          noun="labels and emoji"
          conflictSummary={
            <ul>
              <li>Labels: {listed((server.theme.labels ?? []).map((label) => label.title))}</li>
              <li>Emoji: {listed((server.emoji ?? []).map((entry) => `:${entry.name}:`))}</li>
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

        <div className={styles.columns()}>
          <SettingsSection
            level={2}
            title="Labels"
            description={
              <>
                Part of the theme. The{' '}
                <Link to="/admin/settings/theme" className={textLinkClassName()}>
                  theme doctor
                </Link>{' '}
                checks that each one reads in both schemes.
              </>
            }
          >
            <LabelsEditor
              labels={theme.labels}
              generated={generated.labels}
              light={generated.light}
              dark={generated.dark}
              emoji={(settings.emoji ?? []).map((entry) => entry.name)}
              emojiSources={served}
              onLabelsChange={(labels) => {
                draft.change({
                  ...settings,
                  theme: withOptional(forkedIfBuiltin(theme), 'labels', labels),
                })
              }}
            />
          </SettingsSection>

          <SettingsSection level={2} title="Emoji">
            <EmojiEditor
              emoji={settings.emoji}
              served={served}
              light={generated.light}
              dark={generated.dark}
              onEmojiChange={(emoji) => {
                const { emoji: _previous, ...rest } = settings
                draft.change(emoji === undefined ? rest : { ...rest, emoji })
              }}
            />
          </SettingsSection>
        </div>
      </SettingsSection>

      {compact ? (
        <SettingsActionBar label="Labels and emoji actions">
          <p className="min-w-0 grow truncate text-xs text-muted">
            {draft.dirty ? 'Unsaved changes' : 'Nothing to save'}
          </p>
          {saveButton}
        </SettingsActionBar>
      ) : undefined}
    </>
  )
}
