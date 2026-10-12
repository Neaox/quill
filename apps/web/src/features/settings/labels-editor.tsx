import { useState } from 'react'

import { Button, Input, tv } from '@quill/ui'

import {
  ACCENT_SWATCHES,
  DEFAULT_LABEL_CHROMA,
  MAX_LABELS,
  choiceOfSwatch,
  labelNameProblem,
  type GeneratedLabel,
  type TokenMap,
} from '@quill/theme'

import type { ThemeSettings } from '../../lib/api/index.ts'
import { useCustomProperty } from '../../lib/dom/use-custom-property.ts'
import { SelectField } from '../../lib/forms/select-field.tsx'
import { ColourControl } from './colour/colour-control.tsx'
import { EmojiImage, type ServedEmoji } from './emoji-image.tsx'

export type LabelSeeds = NonNullable<ThemeSettings['labels']>
type LabelSeed = LabelSeeds[number]

const labelsStyles = tv({
  slots: {
    root: '@container m-0 flex flex-col gap-3 border-0 p-0',
    // The screen's own heading shows the name; the legend gives the fields it groups.
    legend: 'sr-only',
    intro: 'text-xs leading-normal text-muted',
    list: 'm-0 flex list-none flex-col gap-2 p-0',
    item: 'flex flex-col gap-3 rounded-md border border-border bg-surface-raised p-3',
    header: 'flex items-start justify-between gap-3',
    identity: 'flex min-w-0 flex-col gap-1',
    syntax: 'truncate font-mono text-2xs text-muted',
    previews: 'flex flex-wrap gap-2',
    adder: 'flex flex-col items-start gap-2',
    fields: 'grid w-full items-start gap-2 @xs:grid-cols-2',
    full: 'text-xs text-muted',
  },
})

/**
 * The pill a document shows, as a reader in one scheme sees it: the label's
 * generated fill and ink, on that scheme's page. Painted through custom
 * properties rather than a `style` attribute, which the CSP refuses.
 */
const pillStyles = tv({
  slots: {
    page: [
      'inline-flex items-center gap-2 rounded-md border border-border bg-(--preview-page) px-2.5 py-1.5',
    ],
    scheme: 'text-2xs text-(--preview-ink)',
    pill: [
      'inline-block rounded-full bg-(--label-fill) px-2 py-0.5 text-2xs leading-tight font-semibold',
      'whitespace-nowrap',
    ],
    words: 'text-(--label-ink)',
    lead: 'me-1 inline-block h-[1.3333em] w-auto align-[-0.25em]',
  },
})

interface LabelPillProps {
  readonly scheme: 'light' | 'dark'
  readonly title: string
  readonly label: GeneratedLabel
  readonly page: TokenMap
  /** The emoji the pill leads with, when it has one (ADR-038). */
  readonly lead?: ServedEmoji | undefined
}

function LabelPill({ scheme, title, label, page, lead }: LabelPillProps) {
  const styles = pillStyles()
  const colours = label[scheme]
  return (
    <span
      ref={useCustomProperty('--preview-page', page['--palette-background'])}
      className={styles.page()}
    >
      <span
        ref={useCustomProperty('--preview-ink', page['--palette-muted'])}
        className={styles.scheme()}
      >
        {scheme === 'light' ? 'Light' : 'Dark'}
      </span>
      <span ref={useCustomProperty('--label-fill', colours.fill)} className={styles.pill()}>
        {lead === undefined ? undefined : (
          <EmojiImage className={styles.lead()} image={lead} alt="" />
        )}
        <span ref={useCustomProperty('--label-ink', colours.ink)} className={styles.words()}>
          {title}
        </span>
      </span>
    </span>
  )
}

export interface LabelsEditorProps {
  readonly labels: ThemeSettings['labels']
  /** The labels as the generator settled them, in the same order, for the previews. */
  readonly generated: readonly GeneratedLabel[]
  readonly light: TokenMap
  readonly dark: TokenMap
  /** The organisation's own emoji names, any of which a label's pill may lead with (ADR-038). */
  readonly emoji?: readonly string[]
  /** Where each saved emoji is served, by name, so a pill's preview shows its lead. */
  readonly emojiSources?: ReadonlyMap<string, ServedEmoji>
  readonly onLabelsChange: (labels: LabelSeeds | undefined) => void
}

/**
 * The organisation's labels (ADR-037): a name a document writes as
 * `:support[Support]`, what settings call it, and a colour, previewed as the
 * pill a reader sees in both schemes. The theme doctor beside the form says
 * whether each one reads; the generator has already settled them so it can.
 *
 * A name cannot be changed once it is added, because documents use it:
 * removing a label and adding another is the honest way to rename one, and
 * documents that still say the old name fall back to their literal text.
 */
export function LabelsEditor({
  labels,
  generated,
  light,
  dark,
  emoji = [],
  emojiSources = new Map(),
  onLabelsChange,
}: LabelsEditorProps) {
  const entries = labels ?? []
  const styles = labelsStyles()

  function replace(next: LabelSeeds) {
    onLabelsChange(next.length === 0 ? undefined : next)
  }

  function update(name: string, change: Partial<LabelSeed>) {
    replace(entries.map((entry) => (entry.name === name ? { ...entry, ...change } : entry)))
  }

  return (
    <fieldset className={styles.root()}>
      <legend className={styles.legend()}>Labels</legend>
      <p className={styles.intro()}>
        A coloured pill for something your documents name often, such as a channel or a team. Write{' '}
        <code>:name[Text]</code> in a document; drawings colour the class of the same name.
      </p>

      {entries.length === 0 ? undefined : (
        <ul className={styles.list()}>
          {entries.map((entry) => {
            const settled = generated.find((candidate) => candidate.name === entry.name)
            const lead = emojiSources.get(
              entry.emoji ?? (emoji.includes(entry.name) ? entry.name : ''),
            )
            return (
              <li key={entry.name} className={styles.item()}>
                <div className={styles.header()}>
                  <div className={styles.identity()}>
                    <Input
                      label="Title"
                      value={entry.title}
                      maxLength={60}
                      {...(entry.title.trim() === '' ? { error: 'A label needs a title.' } : {})}
                      onChange={(event) => {
                        update(entry.name, { title: event.target.value })
                      }}
                    />
                    <code className={styles.syntax()}>
                      :{entry.name}[{entry.title}]
                    </code>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove the label ${entry.title || entry.name}`}
                    onClick={() => {
                      replace(entries.filter((other) => other.name !== entry.name))
                    }}
                  >
                    Remove
                  </Button>
                </div>
                <ColourControl
                  compact
                  label={`Colour of ${entry.title || entry.name}`}
                  value={{ hue: entry.hue, chroma: entry.chroma ?? DEFAULT_LABEL_CHROMA }}
                  onValueChange={({ hue, chroma }) => {
                    // A label is a hue and a strength; the generator places
                    // its lightness, so a brand colour's own is not kept.
                    update(entry.name, { hue, chroma })
                  }}
                />
                {emoji.length === 0 ? undefined : (
                  <SelectField
                    label="Emoji"
                    value={entry.emoji ?? ''}
                    description="Shown in the pill in place of the dot."
                    onChange={(event) => {
                      const chosen = event.target.value
                      const { emoji: _previous, ...rest } = entry
                      const next = chosen === '' ? rest : { ...rest, emoji: chosen }
                      replace(entries.map((other) => (other.name === entry.name ? next : other)))
                    }}
                  >
                    <option value="">
                      {emoji.includes(entry.name) ? `:${entry.name}: (same name)` : 'None'}
                    </option>
                    {emoji
                      .filter((name) => name !== entry.name)
                      .map((name) => (
                        <option key={name} value={name}>
                          :{name}:
                        </option>
                      ))}
                  </SelectField>
                )}
                {settled === undefined ? undefined : (
                  <div
                    className={styles.previews()}
                    aria-label={`Preview of ${entry.title}`}
                    role="group"
                  >
                    <LabelPill
                      scheme="light"
                      title={entry.title}
                      label={settled}
                      page={light}
                      lead={lead}
                    />
                    <LabelPill
                      scheme="dark"
                      title={entry.title}
                      label={settled}
                      page={dark}
                      lead={lead}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {entries.length >= MAX_LABELS ? (
        <p className={styles.full()}>
          A theme holds at most {MAX_LABELS} labels; more than that cannot be told apart.
        </p>
      ) : (
        <LabelAdder
          existing={entries.map((entry) => entry.name)}
          onAdd={(name, title) => {
            // Each new label starts on the next swatch round the wheel, so two
            // added in a row are never the same colour.
            const swatch = ACCENT_SWATCHES[entries.length % ACCENT_SWATCHES.length]
            const { hue, chroma } =
              swatch === undefined
                ? { hue: 255, chroma: DEFAULT_LABEL_CHROMA }
                : choiceOfSwatch(swatch)
            replace([...entries, { name, title, hue, chroma }])
          }}
        />
      )}
    </fieldset>
  )
}

interface LabelAdderProps {
  readonly existing: readonly string[]
  readonly onAdd: (name: string, title: string) => void
}

function LabelAdder({ existing, onAdd }: LabelAdderProps) {
  // Plain fields, not a settings draft: they hold a label on its way into the
  // theme, have no revision, and are never saved on their own.
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const styles = labelsStyles()
  const problem = name === '' ? undefined : labelNameProblem(name, existing)

  return (
    <div className={styles.adder()}>
      <div className={styles.fields()}>
        <Input
          label="Name"
          value={name}
          spellCheck={false}
          autoComplete="off"
          description="Lower-case, as documents write it."
          {...(problem === undefined ? {} : { error: problem })}
          onChange={(event) => {
            setName(event.target.value.trim().toLowerCase())
          }}
        />
        <Input
          label="Title"
          value={title}
          maxLength={60}
          onChange={(event) => {
            setTitle(event.target.value)
          }}
        />
      </div>
      <Button
        size="sm"
        variant="secondary"
        disabled={name === '' || problem !== undefined}
        onClick={() => {
          onAdd(name, title.trim() === '' ? name : title.trim())
          setName('')
          setTitle('')
        }}
      >
        Add label
      </Button>
    </div>
  )
}
