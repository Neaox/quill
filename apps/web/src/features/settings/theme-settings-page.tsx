import { useMemo, useState } from 'react'

import { Button, Callout, Input, tv } from '@quill/ui'

import {
  BUILTIN_THEMES,
  CURATED_FACE_IDS,
  OFFERED_THEME_IDS,
  curatedFace,
  describeColour,
  describeGreys,
  forkTheme,
  generateTheme,
  resetToBase,
  successorOf,
  verdictOf,
  withAccent,
} from '@quill/theme'

import {
  useLoadedOrganisationSettings,
  useSaveOrganisationSettings,
  type OrganisationSettings,
  type ThemeSettings,
} from '../../lib/api/index.ts'
import { SelectField } from '../../lib/forms/select-field.tsx'
import { COMPACT_EDITOR_QUERY, useMediaQuery } from '../layout/use-media-query.ts'
import { ColourControl } from './colour/colour-control.tsx'
import { ToneControl } from './colour/tone-control.tsx'
import { RangeField } from './range-field.tsx'
import { SettingsActions, SettingsSection } from './settings-frame.tsx'
import { SettingsFormFeedback } from './settings-form-feedback.tsx'
import { SettingsSaveButton } from './settings-save-button.tsx'
import { UnsavedChangesGuard } from './unsaved-changes-guard.tsx'
import { focusDoctorGroup, ThemeDoctor } from './theme-doctor.tsx'
import { ThemePreview } from './theme-preview.tsx'
import { ThemePreviewBar } from './theme-preview-bar.tsx'
import {
  FORK_ID,
  FORK_NAME,
  forkedIfBuiltin,
  isBuiltinThemeId,
  withOptional,
} from './theme-fork.ts'
import { useSettingsDraft } from './use-settings-draft.ts'

/**
 * The theme editor (ADR-028, layer 2).
 *
 * Three things this screen is, and one it is not.
 *
 * It is **the levers, first**: accent, tone, reading face, radius, density and
 * per-collection colours, which is what onboarding sets and what most tenants
 * ever touch. Individual tokens and the type pairing remain editable in the
 * settings document and are deliberately not here yet — "everything else, one
 * click away" is a later screen, not a reason to put fifty colour pickers in
 * front of somebody on their first visit.
 *
 * It is **a live preview of a real document**, in light and dark at once,
 * painted with the palettes the edited document generates in this browser.
 * `generateTheme` is pure — seeds in, two token maps and a doctor report out —
 * so moving a lever is a recomputation rather than a round trip, and what is
 * on screen is what the server will write.
 *
 * It is **the doctor's report beside the form**, because that is where the
 * advice is worth anything: the one rule enforced by default is AA text
 * contrast, and when it warns the administrator is shown the reason and the
 * instance switch that makes it advisory, in the same place. Nothing here
 * refuses a save — ADR-028 is explicit that the doctor advises.
 *
 * It is **not the onboarding flow**. The guided path — a logo, three
 * questions, a suggested built-in — is a separate screen; until it exists,
 * the three built-ins are offered directly below, which is the same choice
 * with the questions left out.
 *
 * Everything saves through the organisation settings API, because a theme is
 * a field of the organisation's document and not a resource of its own. A save
 * applies at once: the server renders the saved document as the stylesheet
 * every page links (ADR-028, "Delivery"), and the save invalidates the summary
 * that names it, so this screen and every other open one re-theme without a
 * reload.
 *
 * The theme's labels (ADR-037) are part of the same document but are edited
 * on Labels and emoji (`labels-and-emoji-page.tsx`), beside the organisation's
 * emoji they lead with; the doctor here still checks that each one reads.
 */

/**
 * Two surfaces, not one reflowed. From the compact breakpoint up, the levers
 * and the preview are columns and the preview is sticky, so it stays in view
 * while the levers scroll; the doctor's full report follows below both at the body's width,
 * where its findings read on one line. Below it, the levers are the page and
 * the preview is a sheet behind `ThemePreviewBar`.
 */
const themeStyles = tv({
  slots: {
    // One column that never grows past its track, so nothing in it can push
    // the page past its gutter on a phone.
    columns: [
      'grid grid-cols-[minmax(0,1fr)] items-start gap-8',
      '@4xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] @4xl:gap-10',
    ],
    levers: 'flex max-w-(--layout-content) flex-col gap-5 @4xl:max-w-none',
    preview: [
      'flex flex-col gap-3 @4xl:sticky',
      '@4xl:top-[calc(var(--spacing-shell-header)+var(--spacing)*6)]',
    ],
    subheading: 'text-sm font-medium text-foreground',
    previewLead: 'mt-1 text-xs text-muted',
    doctor: 'flex flex-col gap-2',
    baseList: 'flex flex-wrap gap-2',
  },
  variants: {
    /** A phone's base choices are a grid of full-width, 44-pixel targets. */
    compact: { true: { baseList: 'grid grid-cols-2 sm:grid-cols-3' } },
  },
})

/**
 * The curated faces a document's body may be set in.
 *
 * Built from `CURATED_FACE_IDS` rather than `CURATED_FACE_LIST`, because the
 * ids are what a theme document stores and only the id list carries them as
 * the literal union the schema declares; the list's `id` is a plain string.
 */
const READING_FACES = CURATED_FACE_IDS.map((id) => ({ id, face: curatedFace(id) })).filter(
  (entry) => entry.face.roles.includes('reading'),
)

const DENSITIES = ['comfortable', 'compact'] as const

export function ThemeSettingsPage() {
  const compact = useMediaQuery(COMPACT_EDITOR_QUERY)
  const loaded = useLoadedOrganisationSettings()
  const save = useSaveOrganisationSettings()
  const draft = useSettingsDraft<OrganisationSettings>(loaded.data.settings, loaded.data.revision)

  const settings = draft.value
  const server = loaded.data.settings
  const theme = settings.theme
  const enforcement = settings.policies.contrastEnforcement

  // Pure: the same document and the same enforcement always produce the same
  // palettes and the same report, so this is a memo rather than an effect.
  const generated = useMemo(
    () => generateTheme(theme, { textContrast: enforcement }),
    [theme, enforcement],
  )

  function updateTheme(next: ThemeSettings) {
    draft.change({ ...settings, theme: next })
  }

  /** Every lever goes through here, so every lever forks a built-in exactly once. */
  function changeTheme(change: (current: ThemeSettings) => ThemeSettings) {
    updateTheme(change(forkedIfBuiltin(theme)))
  }

  function submit() {
    save.mutate(
      { settings, expectedRevision: draft.revision, changeNote: 'Theme' },
      { onSuccess: (saved) => draft.reset(saved.settings, saved.revision) },
    )
  }

  const styles = themeStyles({ compact })
  const saveButton = (
    <SettingsSaveButton
      compact={compact}
      dirty={draft.dirty}
      pending={save.isPending}
      onSave={submit}
    />
  )
  /**
   * Which built-in this theme stands on: the fork's `base` once it has been
   * forked, and the theme's own id before that, because a fresh instance *is*
   * the built-in even though nothing has recorded a base yet. Without the
   * second half the buttons all read unpressed while the sentence beneath
   * them says which one is in use. A superseded base presses its successor,
   * which is what a reset would now return to.
   */
  const savedBase = theme.base ?? (isBuiltinThemeId(theme.id) ? theme.id : undefined)
  const base = savedBase === undefined ? undefined : successorOf(savedBase)

  return (
    <>
      <UnsavedChangesGuard dirty={draft.dirty} what="theme" />
      {compact ? undefined : <SettingsActions>{saveButton}</SettingsActions>}

      <SettingsSection
        title="Theme"
        description="The organisation’s identity: its colour seeds, its reading face, its shape. Every workspace inherits it and none may change it."
        wide
      >
        {draft.dirty ? undefined : (
          <p className="text-xs text-muted">
            Nothing has changed yet, so there is nothing to save.
          </p>
        )}

        <SettingsFormFeedback
          error={save.error}
          noun="theme settings"
          conflictSummary={
            <ul>
              <li>Theme: {server.theme.name}</li>
              <li>Accent colour: {describeColour(server.theme.seeds.accent)}</li>
              <li>Greys: {describeGreys(server.theme.seeds)}</li>
              <li>Density: {server.theme.shape.density}</li>
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

        {/*
         * TODO(M3): the guided flow — a logo, the three questions, and a
         * suggested built-in — is the entry point ADR-028 describes and is
         * built on a later branch. `suggestBase` and `extractSeedsFromColours`
         * in `@quill/theme` are the pieces it needs; what is below is the same
         * choice with the questions left out, which is why this is a note and
         * not a control that would do nothing (docs/design/feedback.md).
         */}
        <Callout
          tone="info"
          title="Setting this up for the first time?"
          className="max-w-(--layout-content)"
        >
          The guided flow — upload a logo, answer three questions, see the suggestion on a real
          document — is not built yet. Until it is, start from the built-in that fits best and
          adjust the levers.
        </Callout>

        <div className={styles.columns()}>
          <div className={styles.levers()}>
            <fieldset className="flex flex-col gap-2 border-0 p-0">
              <legend className="text-sm font-medium text-foreground">Start from</legend>
              <p className="text-xs text-muted">
                Each built-in is complete as it is. Choosing one replaces every lever below with its
                values and keeps it as the base this theme can be reset to.
              </p>
              <div className={styles.baseList()}>
                {OFFERED_THEME_IDS.map((id) => (
                  <Button
                    key={id}
                    size={compact ? 'xl' : 'sm'}
                    variant={base === id ? 'primary' : 'secondary'}
                    aria-pressed={base === id}
                    onClick={() => {
                      updateTheme(forkTheme(id, { id: FORK_ID, name: FORK_NAME }))
                    }}
                  >
                    {BUILTIN_THEMES[id].name}
                  </Button>
                ))}
              </div>
              {base === undefined ? (
                <p className="text-xs text-muted">
                  This organisation is on the built-in theme {theme.name}. The first change forks
                  it, so the built-in stays as it shipped.
                </p>
              ) : (
                <p className="text-xs text-muted">
                  Forked from {BUILTIN_THEMES[base].name}.{' '}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      updateTheme(resetToBase(theme))
                    }}
                  >
                    Reset to {BUILTIN_THEMES[base].name}
                  </Button>
                </p>
              )}
            </fieldset>

            <Input
              label="Theme name"
              value={theme.name}
              maxLength={80}
              description="What this identity is called in settings and in an export."
              onChange={(event) => {
                changeTheme((current) => ({ ...current, name: event.target.value }))
              }}
            />

            <ColourControl
              label="Accent"
              value={theme.seeds.accent}
              onValueChange={(accent) => {
                changeTheme((current) => withAccent(current, accent))
              }}
            />

            <ToneControl
              tone={theme.seeds.tone}
              accentHue={theme.seeds.accent.hue}
              onToneChange={(tone) => {
                changeTheme((current) => ({ ...current, seeds: { ...current.seeds, tone } }))
              }}
            />

            <SelectField
              label="Reading face"
              value={theme.type.reading.source === 'curated' ? theme.type.reading.id : ''}
              description="The face a document’s body is set in. The interface and mono faces are part of the identity and change with the built-in."
              onChange={(event) => {
                const chosen = event.target.value
                const entry = READING_FACES.find((candidate) => candidate.id === chosen)
                if (entry === undefined) return
                changeTheme((current) => ({
                  ...current,
                  type: { ...current.type, reading: { source: 'curated', id: entry.id } },
                }))
              }}
            >
              {theme.type.reading.source === 'uploaded' ? (
                <option value="">{theme.type.reading.family} (uploaded)</option>
              ) : undefined}
              {READING_FACES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.face.family}
                </option>
              ))}
            </SelectField>

            <RangeField
              label="Corner radius"
              value={theme.shape.radiusStep}
              min={0}
              max={4}
              step={1}
              display={`Step ${theme.shape.radiusStep}`}
              description="Nought is square; four is fully rounded. The scale itself is an invariant."
              onValueChange={(radiusStep) => {
                changeTheme((current) => ({
                  ...current,
                  shape: { ...current.shape, radiusStep },
                }))
              }}
            />

            <SelectField
              label="Density"
              value={theme.shape.density}
              description="Compact is one step tighter everywhere: the spacing scale moves, not the type."
              onChange={(event) => {
                const value = event.target.value
                const density = DENSITIES.find((candidate) => candidate === value)
                if (density === undefined) return
                changeTheme((current) => ({ ...current, shape: { ...current.shape, density } }))
              }}
            >
              {DENSITIES.map((density) => (
                <option key={density} value={density}>
                  {density === 'compact' ? 'Compact' : 'Comfortable'}
                </option>
              ))}
            </SelectField>

            <CollectionColours
              collections={theme.collections}
              onCollectionsChange={(collections) => {
                changeTheme((current) => withOptional(current, 'collections', collections))
              }}
            />
          </div>

          {compact ? undefined : (
            <div className={styles.preview()}>
              <div>
                <h2 className={styles.subheading()}>Preview</h2>
                <p className={styles.previewLead()}>
                  A document in this theme, light and dark. Updates as you change the theme.
                </p>
              </div>
              <ThemePreview light={generated.light} dark={generated.dark} />
            </div>
          )}
        </div>

        <div className={styles.doctor()}>
          <h2 className={styles.subheading()}>Theme doctor</h2>
          <ThemeDoctor
            report={generated.report}
            theme={theme}
            contrastEnforcement={enforcement}
            onThemeChange={changeTheme}
            onRelaxEnforcement={() => {
              draft.change({
                ...settings,
                policies: { ...settings.policies, contrastEnforcement: 'advisory' },
              })
            }}
          />
        </div>
      </SettingsSection>

      {compact ? (
        <ThemePreviewBar
          light={generated.light}
          dark={generated.dark}
          summary={verdictOf(generated.report.results)}
          onReview={() => {
            focusDoctorGroup('warn')
          }}
          save={saveButton}
        />
      ) : undefined}
    </>
  )
}

type CollectionSeeds = NonNullable<ThemeSettings['collections']>

interface CollectionColoursProps {
  readonly collections: ThemeSettings['collections']
  readonly onCollectionsChange: (collections: CollectionSeeds | undefined) => void
}

/**
 * Per-collection colours: one hue per collection name, for the identities a
 * tabbed navigation and a coloured tree row take (ADR-028, layer 2's last
 * lever).
 *
 * A collection is named here rather than picked from a list, because these
 * seeds belong to the organisation's theme and the organisation has many
 * workspaces, each with its own collections; the name is the key the theme
 * and a workspace agree on.
 */
function CollectionColours({ collections, onCollectionsChange }: CollectionColoursProps) {
  const entries = Object.entries(collections ?? {})

  function replace(next: CollectionSeeds) {
    onCollectionsChange(Object.keys(next).length === 0 ? undefined : next)
  }

  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0">
      <legend className="text-sm font-medium text-foreground">Collection colours</legend>
      <p className="text-xs text-muted">
        A hue per collection name, used where collections are shown as tabs or coloured rows.
      </p>

      {entries.map(([name, seed]) => (
        <div key={name} className="flex flex-col gap-1 rounded-md border border-border p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-foreground">{name}</span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove the colour for ${name}`}
              onClick={() => {
                replace(Object.fromEntries(entries.filter(([key]) => key !== name)))
              }}
            >
              Remove
            </Button>
          </div>
          <RangeField
            label={`${name} hue`}
            value={seed.hue}
            min={0}
            max={359}
            step={1}
            display={`${Math.round(seed.hue)}°`}
            onValueChange={(hue) => {
              replace({ ...Object.fromEntries(entries), [name]: { ...seed, hue } })
            }}
          />
        </div>
      ))}

      <CollectionColourAdder
        existing={entries.map(([name]) => name)}
        onAdd={(name) => {
          replace({ ...Object.fromEntries(entries), [name]: { hue: 250, chroma: 0.1 } })
        }}
      />
    </fieldset>
  )
}

interface CollectionColourAdderProps {
  readonly existing: readonly string[]
  readonly onAdd: (name: string) => void
}

function CollectionColourAdder({ existing, onAdd }: CollectionColourAdderProps) {
  // A plain field, not a settings draft: it holds a name on its way into the
  // theme, has no revision, and is never saved on its own.
  const [typed, setTyped] = useState('')
  const name = typed.trim()
  const duplicate = existing.includes(name)

  return (
    <div className="flex items-end gap-2">
      <Input
        label="Collection name"
        value={typed}
        className="grow"
        {...(duplicate ? { error: 'That collection already has a colour.' } : {})}
        onChange={(event) => {
          setTyped(event.target.value)
        }}
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={name === '' || duplicate}
        onClick={() => {
          onAdd(name)
          setTyped('')
        }}
      >
        Add
      </Button>
    </div>
  )
}
