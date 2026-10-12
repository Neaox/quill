import { Button, InfoPopover, Input } from '@quill/ui'

import {
  useLoadedOrganisationSettings,
  useSaveOrganisationSettings,
  type OrganisationSettings,
} from '../../lib/api/index.ts'
import { menuIsValid } from './public-menu/menu-model.ts'
import { PublicMenuEditor } from './public-menu/public-menu-editor.tsx'
import { SettingsActions, SettingsSection } from './settings-frame.tsx'
import { SettingsFormFeedback } from './settings-form-feedback.tsx'
import { ToggleField } from './toggle-field.tsx'
import { UnsavedChangesGuard } from './unsaved-changes-guard.tsx'
import { useSettingsDraft } from './use-settings-draft.ts'

const MAX_NAME_LENGTH = 120

/**
 * The organisation: its name, its mark, the links on its public site, and the
 * three policies that apply to every workspace in it (ADR-034).
 *
 * Everything on this screen is the organisation's to decide and every
 * workspace's to inherit — ADR-028's "who decides what" table, the top three
 * rows — which is why none of it appears in workspace settings.
 *
 * Saving states the revision the **draft** was forked from, not whatever the
 * cache holds now: the server treats it as the expected value of a
 * compare-and-swap over the file's own bytes, so a write whose file has
 * changed underneath is refused rather than merged, and the refusal is a state
 * on this screen rather than an error toast.
 */
export function OrganisationSettingsPage() {
  const loaded = useLoadedOrganisationSettings()
  const save = useSaveOrganisationSettings()
  const draft = useSettingsDraft<OrganisationSettings>(loaded.data.settings, loaded.data.revision)

  const settings = draft.value
  const server = loaded.data.settings
  const menuValid = menuIsValid(settings.publicMenu)
  const nameValid = settings.name.trim() !== '' && settings.name.length <= MAX_NAME_LENGTH
  const ready = draft.dirty && menuValid && nameValid

  function update(next: Partial<OrganisationSettings>) {
    draft.change({ ...settings, ...next })
  }

  function submit() {
    save.mutate(
      { settings, expectedRevision: draft.revision, changeNote: 'Organisation' },
      { onSuccess: (saved) => draft.reset(saved.settings, saved.revision) },
    )
  }

  return (
    <>
      <UnsavedChangesGuard dirty={draft.dirty} what="organisation settings" />
      <SettingsActions>
        <Button size="sm" loading={save.isPending} disabled={!ready} onClick={submit}>
          Save
        </Button>
      </SettingsActions>

      <SettingsSection
        title="Organisation"
        description="The name and mark every screen carries, what the public site links to, and what workspaces are allowed to do."
      >
        {ready ? undefined : (
          <p className="text-xs text-muted">
            {draft.dirty
              ? 'Some of this is not valid yet, so there is nothing to save.'
              : 'Nothing has changed yet, so there is nothing to save.'}
          </p>
        )}

        <SettingsFormFeedback
          error={save.error}
          noun="organisation settings"
          conflictSummary={<OrganisationSummary settings={server} />}
          onReload={() => {
            draft.reset(server, loaded.data.revision)
            save.reset()
          }}
          onReplace={() => {
            draft.adoptRevision(loaded.data.revision)
            save.reset()
          }}
        />

        <Input
          label="Organisation name"
          value={settings.name}
          maxLength={MAX_NAME_LENGTH}
          description="Shown in the top bar of every signed-in page. The public site and exports carry it too, once each of those is built."
          {...(nameValid ? {} : { error: 'Give the organisation a name.' })}
          onChange={(event) => {
            update({ name: event.target.value })
          }}
        />

        <LogoField settings={settings} />
      </SettingsSection>

      <SettingsSection
        title="Public menu"
        description="The links and dropdowns in the public site’s header. Link documents and collections by what they are, so a rename or a move is in the header straight away, or link anywhere on the web."
        level={2}
        wide
      >
        <PublicMenuEditor
          menu={settings.publicMenu}
          siteName={settings.name}
          onMenuChange={(publicMenu) => {
            update({ publicMenu: [...publicMenu] })
          }}
        />
      </SettingsSection>

      <SettingsSection
        title="Policies"
        description="What every workspace in this organisation may do, and how strictly its theme is judged."
        level={2}
      >
        <ToggleField
          label="Allow share links"
          description="A person with manage on a document can create a link that shows it to somebody without an account."
          checked={settings.policies.shareLinksAllowed}
          onCheckedChange={(checked) => {
            update({ policies: { ...settings.policies, shareLinksAllowed: checked } })
          }}
        />
        <ToggleField
          label="Allow publishing to the public web"
          description="A collection can be published to a site anybody can read, with no account."
          checked={settings.policies.publicPublishingAllowed}
          onCheckedChange={(checked) => {
            update({ policies: { ...settings.policies, publicPublishingAllowed: checked } })
          }}
        />
        <ToggleField
          label="Enforce AA text contrast"
          description="A theme whose text falls below AA contrast is marked as one to act on. Off, it is reported beside every other rule. Either way the theme doctor advises and never refuses a save."
          help={<ContrastHelp />}
          checked={settings.policies.contrastEnforcement === 'enforced'}
          onCheckedChange={(checked) => {
            update({
              policies: {
                ...settings.policies,
                contrastEnforcement: checked ? 'enforced' : 'advisory',
              },
            })
          }}
        />
      </SettingsSection>
    </>
  )
}

/**
 * The organisation's mark.
 *
 * A logo is a reference to a blob — a SHA-256 and a media type — and nothing
 * stores or serves one for an organisation, so there is no upload control
 * here: a control that cannot do what it offers teaches people not to trust
 * the next one (`docs/design/feedback.md`). Attachments landed, but they are
 * per *document*: a logo belongs to no document, its route would have to be
 * anonymous, and the upload allowlist refuses the SVG this schema allows.
 * What is shown is the reference itself when a settings file already carries
 * one, which is what an administrator restoring an export needs to see.
 *
 * TODO(M3): replace this readout with an upload when an organisation-scoped
 * blob route exists; the field, its `hash`/`mediaType`/`alt` shape and the
 * settings document are already in place for it.
 */
function LogoField({ settings }: { readonly settings: OrganisationSettings }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-foreground">Logo</p>
      {settings.logo === undefined ? (
        <p className="text-xs text-muted">
          No logo yet. Uploading one needs a store that serves an organisation rather than a
          document; until then the organisation’s name stands on its own.
        </p>
      ) : (
        <p className="text-xs text-muted">
          <code>{settings.logo.mediaType}</code>, stored as{' '}
          <code>{settings.logo.hash.slice(0, 12)}…</code>, described as “{settings.logo.alt}”.
        </p>
      )}
    </div>
  )
}

/** What is on the server now, for the conflict notice: the values, not a diff. */
function OrganisationSummary({ settings }: { readonly settings: OrganisationSettings }) {
  return (
    <ul>
      <li>Name: {settings.name}</li>
      <li>
        Public menu:{' '}
        {settings.publicMenu.length === 0
          ? 'no links'
          : `${settings.publicMenu.length} ${settings.publicMenu.length === 1 ? 'item' : 'items'}`}
      </li>
      <li>Share links: {settings.policies.shareLinksAllowed ? 'allowed' : 'not allowed'}</li>
      <li>
        Public publishing: {settings.policies.publicPublishingAllowed ? 'allowed' : 'not allowed'}
      </li>
      <li>Contrast enforcement: {settings.policies.contrastEnforcement}</li>
    </ul>
  )
}

/** The W3C's own explanation of the AA contrast minimum (WCAG 2.2, success criterion 1.4.3). */
const CONTRAST_MINIMUM_GUIDANCE =
  'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html'

/**
 * What "AA" means, for the many people who have never met WCAG: the setting
 * assumes it, so the explanation sits beside it rather than in a manual.
 */
function ContrastHelp() {
  return (
    <InfoPopover
      label="About AA text contrast"
      title="What AA text contrast means"
      learnMore={{ href: CONTRAST_MINIMUM_GUIDANCE, label: 'Read the W3C guidance' }}
    >
      <p>
        Text needs to stand out enough from what is behind it to be read by people with low vision,
        on a dim or glaring screen, or in sunlight.
      </p>
      <p className="mt-2">
        AA is the level of the Web Content Accessibility Guidelines that most organisations and many
        laws ask for: a contrast ratio of at least 4.5 to 1 for body text, and 3 to 1 for large
        text.
      </p>
    </InfoPopover>
  )
}
