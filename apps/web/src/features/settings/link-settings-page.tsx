import { useId } from 'react'

import type { LinkPreviewMode, OrganisationDefaultDisplay } from '@quill/domain'
import { BRAND } from '@quill/brand'
import { Textarea, tv } from '@quill/ui'

import {
  useLoadedOrganisationSettings,
  useSaveOrganisationSettings,
  type OrganisationSettings,
} from '../../lib/api/index.ts'
import { SegmentedControl } from '../theme/segmented-control.tsx'
import type { Segment } from '../theme/segmented-control.tsx'
import { COMPACT_EDITOR_QUERY, useMediaQuery } from '../layout/use-media-query.ts'
import {
  cleanedLinkSettings,
  linkSettingsOf,
  patternProblems,
  withLinkSettings,
} from './link-settings-model.ts'
import type { LinkSettings, PatternProblem } from './link-settings-model.ts'
import { SettingsActionBar } from './settings-action-bar.tsx'
import { SettingsActions, SettingsSection } from './settings-frame.tsx'
import { SettingsFormFeedback } from './settings-form-feedback.tsx'
import { SettingsSaveButton } from './settings-save-button.tsx'
import { ToggleField } from './toggle-field.tsx'
import { UnsavedChangesGuard } from './unsaved-changes-guard.tsx'
import { useSettingsDraft } from './use-settings-draft.ts'

const pageStyles = tv({
  slots: {
    field: 'flex flex-col gap-1.5',
    label: 'text-xs font-medium text-foreground',
    hint: 'text-2xs leading-normal text-muted',
    lists: 'grid grid-cols-[minmax(0,1fr)] items-start gap-6 @4xl:grid-cols-2',
    syntax: 'rounded-md border border-border bg-surface px-3 py-2 text-xs text-foreground-soft',
    summary: 'cursor-pointer font-medium text-foreground',
    examples: 'mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1',
    status: 'text-xs text-muted',
  },
})

const MODES: readonly Segment<LinkPreviewMode>[] = [
  { value: 'off', label: 'Off' },
  { value: 'text', label: 'Text only' },
  { value: 'rich', label: 'Rich' },
]

// The order the choices are read in: from the quietest to the loudest.
const DISPLAYS: readonly Segment<OrganisationDefaultDisplay>[] = [
  { value: 'url', label: 'Link' },
  { value: 'inline', label: 'Inline' },
  { value: 'compact', label: 'Compact' },
  { value: 'card', label: 'Card' },
]

const MODE_SENTENCES: Readonly<Record<LinkPreviewMode, string>> = {
  off: `${BRAND.name} never contacts a site to describe a link. Every link stays a plain link.`,
  text: 'Titles, descriptions and site names, with no pictures fetched, stored or shown.',
  rich: 'Titles, descriptions, thumbnails and site icons.',
}

const DISPLAY_SENTENCES: Readonly<Record<OrganisationDefaultDisplay, string>> = {
  url: 'The link as written, with no preview, until its author chooses another display.',
  inline: 'The site’s icon and the page’s title, in the line of text. The quietest preview.',
  compact: 'Title and site on one line of their own: good for lists of references.',
  card: 'Title, description and thumbnail in a block of their own.',
}

/** Names in a conflict's summary: the values on the server now. */
function LinkSettingsSummary({ settings }: { readonly settings: LinkSettings }) {
  return (
    <ul>
      <li>Previews: {MODES.find((mode) => mode.value === settings.mode)?.label}</li>
      <li>On the public site: {settings.publicSite ? 'yes' : 'no'}</li>
      <li>
        Default display:{' '}
        {DISPLAYS.find((display) => display.value === settings.defaultDisplay)?.label}
      </li>
      <li>Only these sites: {settings.allow.length === 0 ? 'any' : settings.allow.length}</li>
      <li>Never these sites: {settings.block.length === 0 ? 'none' : settings.block.length}</li>
    </ul>
  )
}

function PatternMessages({ problems }: { readonly problems: readonly PatternProblem[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {problems.map((problem) => (
        <li key={problem.line}>
          Line {problem.line}, “{problem.pattern}”: {problem.message}
        </li>
      ))}
    </ul>
  )
}

interface PatternListProps {
  readonly label: string
  readonly description: string
  readonly lines: readonly string[]
  readonly onLinesChange: (lines: readonly string[]) => void
  readonly disabled: boolean
}

/**
 * One list of site patterns, a pattern to a line.
 *
 * A textarea rather than a row of inputs: administrators paste lists, and a
 * line is how every block list they already have is written. Each refused
 * line is named beside the field, with the reason, as it is typed.
 */
function PatternList({ label, description, lines, onLinesChange, disabled }: PatternListProps) {
  const problems = patternProblems(lines)
  return (
    <Textarea
      label={label}
      description={description}
      value={lines.join('\n')}
      rows={6}
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      disabled={disabled}
      {...(problems.length === 0 ? {} : { error: <PatternMessages problems={problems} /> })}
      onChange={(event) => {
        onLinesChange(event.target.value.split('\n'))
      }}
    />
  )
}

/** What a pattern may say, with examples an administrator can copy. */
function PatternSyntax() {
  const styles = pageStyles()
  return (
    <details className={styles.syntax()}>
      <summary className={styles.summary()}>How patterns work</summary>
      <p className="mt-2">
        One pattern to a line. A pattern names a site, and optionally a part of it. It is never a
        regular expression, and it is checked against every address {BRAND.name} contacts for a
        link, including the pages a link redirects to and the images it points at.
      </p>
      <dl className={styles.examples()}>
        <dt>
          <code>example.com</code>
        </dt>
        <dd>That site only, not its subdomains.</dd>
        <dt>
          <code>*.example.com</code>
        </dt>
        <dd>
          Any subdomain, but not <code>example.com</code> itself. List both for both.
        </dd>
        <dt>
          <code>example.com/docs</code>
        </dt>
        <dd>
          That site’s pages at and under <code>/docs</code>, but not <code>/docsx</code>.
        </dd>
        <dt>
          <code>*.example.com/internal/*</code>
        </dt>
        <dd>A trailing * is allowed and means the same as without it.</dd>
      </dl>
      <p className="mt-2">
        A scheme (<code>https://</code>) is ignored. A port, a login, a wildcard anywhere else, a ?
        or a # is refused. If a site is on both lists, blocking wins.
      </p>
    </details>
  )
}

/**
 * Link previews (ADR-042, "Policy"): whether Quill describes links at all, how
 * richly, whether the public site draws them, how a link looks when its author
 * chose nothing, and which sites Quill may or may not contact.
 *
 * Everything here changes what Quill fetches on the organisation's behalf, so
 * a change takes effect on the next page load, in every process. Previews
 * fetched under a looser setting are never shown under a stricter one; the new
 * setting simply fetches its own.
 */
export function LinkSettingsPage() {
  const compact = useMediaQuery(COMPACT_EDITOR_QUERY)
  const loaded = useLoadedOrganisationSettings()
  const save = useSaveOrganisationSettings()
  const draft = useSettingsDraft<OrganisationSettings>(loaded.data.settings, loaded.data.revision)
  const modeHint = useId()
  const displayHint = useId()
  const styles = pageStyles()

  const settings = draft.value
  const links = linkSettingsOf(settings)
  const server = linkSettingsOf(loaded.data.settings)
  const valid =
    patternProblems(links.allow).length === 0 && patternProblems(links.block).length === 0
  const ready = draft.dirty && valid
  const previewsOff = links.mode === 'off'

  function update(next: Partial<LinkSettings>) {
    draft.change(withLinkSettings(settings, { ...links, ...next }))
  }

  function submit() {
    save.mutate(
      {
        settings: withLinkSettings(settings, cleanedLinkSettings(links)),
        expectedRevision: draft.revision,
        changeNote: 'Links',
      },
      { onSuccess: (saved) => draft.reset(saved.settings, saved.revision) },
    )
  }

  const saveButton = (
    <SettingsSaveButton compact={compact} dirty={ready} pending={save.isPending} onSave={submit} />
  )

  return (
    <>
      <UnsavedChangesGuard dirty={draft.dirty} what="link settings" />
      {compact ? undefined : <SettingsActions>{saveButton}</SettingsActions>}

      <SettingsSection
        title="Links"
        description={`How ${BRAND.name} describes the links in your documents. A preview is made by ${BRAND.name} fetching the linked page on your behalf, which tells that site the link was shared.`}
      >
        {ready ? undefined : (
          <p className={styles.status()}>
            {draft.dirty
              ? 'Some patterns are not valid yet, so there is nothing to save.'
              : 'Nothing has changed yet, so there is nothing to save.'}
          </p>
        )}

        <SettingsFormFeedback
          error={save.error}
          noun="link settings"
          conflictSummary={<LinkSettingsSummary settings={server} />}
          onReload={() => {
            draft.reset(loaded.data.settings, loaded.data.revision)
            save.reset()
          }}
          onReplace={() => {
            draft.adoptRevision(loaded.data.revision)
            save.reset()
          }}
        />

        <div className={styles.field()}>
          <p className={styles.label()}>Link previews</p>
          <SegmentedControl
            legend="Link previews"
            describedBy={modeHint}
            segments={MODES}
            value={links.mode}
            onValueChange={(mode) => {
              update({ mode })
            }}
          />
          <p id={modeHint} className={styles.hint()}>
            {MODE_SENTENCES[links.mode]}
          </p>
        </div>

        <div className={styles.field()}>
          <p className={styles.label()}>Default display</p>
          <SegmentedControl
            legend="Default display"
            describedBy={displayHint}
            segments={DISPLAYS}
            value={links.defaultDisplay}
            onValueChange={(defaultDisplay) => {
              update({ defaultDisplay })
            }}
          />
          <p id={displayHint} className={styles.hint()}>
            {DISPLAY_SENTENCES[links.defaultDisplay]} It applies to a link whose author chose
            nothing, in documents, on the public site and in share links. An author can always
            choose another for one link.
          </p>
        </div>

        <ToggleField
          label="Show previews on the public site and share links"
          description={
            previewsOff
              ? 'Previews are off, so every link is plain everywhere.'
              : 'Off, the public site and share links draw plain links. Readers there are strangers, and a preview shows them what a third-party site said.'
          }
          checked={links.publicSite && !previewsOff}
          disabled={previewsOff}
          onCheckedChange={(publicSite) => {
            update({ publicSite })
          }}
        />
      </SettingsSection>

      <SettingsSection
        title="Sites"
        description={`Which sites ${BRAND.name} may contact to describe a link. A link to a site that is not allowed still works as a link; ${BRAND.name} just does not ask that site about it.`}
        level={2}
        wide
      >
        <PatternSyntax />
        <div className={styles.lists()}>
          <PatternList
            label="Only these sites"
            description={`Leave empty to allow any public site. Otherwise ${BRAND.name} contacts only the sites listed.`}
            lines={links.allow}
            disabled={previewsOff}
            onLinesChange={(allow) => {
              update({ allow: [...allow] })
            }}
          />
          <PatternList
            label="Never these sites"
            description={`${BRAND.name} never contacts these sites, whatever the list on the left says.`}
            lines={links.block}
            disabled={previewsOff}
            onLinesChange={(block) => {
              update({ block: [...block] })
            }}
          />
        </div>
      </SettingsSection>

      {compact ? (
        <SettingsActionBar label="Link settings actions">
          <p className="min-w-0 grow truncate text-xs text-muted">
            {draft.dirty ? 'Unsaved changes' : 'Nothing to save'}
          </p>
          {saveButton}
        </SettingsActionBar>
      ) : undefined}
    </>
  )
}
