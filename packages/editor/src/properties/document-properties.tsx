import { Badge, ChevronRightIcon, Input, PropertyReadout, PropertySelect, tv } from '@quill/ui'
import { useId, useState } from 'react'

import { humanise, readProperties, summarise, writeProperty } from './front-matter.ts'
import type { PropertyField } from './front-matter.ts'

/**
 * A document's properties, where its front matter used to be (ADR-005).
 *
 * The writing surface never shows YAML. What the author meets instead is a
 * compact strip above the body: closed, it is one line of facts — type,
 * status, owners, tags — and open, it is the fields those facts come from,
 * plus the template's questions and every other key the document carries.
 *
 * Two rules shape it. Nothing is hidden: a key this release has no control for
 * is still listed, read-only, so an author can see everything their document
 * says about itself (AGENTS.md rule 7). And nothing is invented: the record
 * goes out of here the way it came in, with one value changed, so key order,
 * comments, and unknown fields survive the round trip that
 * `writeFrontMatter` performs downstream.
 */

export const documentPropertiesStyles = tv({
  slots: {
    root: '@container flex flex-col gap-3 border-b border-border pb-4',
    strip: 'flex min-h-7 flex-wrap items-center gap-x-3 gap-y-2',
    toggle: [
      'meta group -ms-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5',
      'transition-colors ease-standard hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    chevron: 'size-3 transition-transform ease-standard group-aria-expanded:rotate-90',
    chips: 'flex list-none flex-wrap items-center gap-1.5',
    /*
     * A badge is a *status*, and is set in caps because a status is one of a
     * few known words. An owner and a tag are values a person chose, so they
     * keep the case they were written in — an address in capitals reads as
     * shouting — and take the badge's geometry and nothing else.
     */
    chip: [
      'inline-flex items-center rounded-sm border border-border bg-surface px-1.5 py-px',
      'font-mono text-2xs whitespace-nowrap text-muted',
    ],
    empty: 'meta-value',
    panel: 'flex flex-col gap-5',
    grid: 'grid grid-cols-1 gap-x-4 gap-y-3 @sm:grid-cols-2 @2xl:grid-cols-3',
    group: 'flex flex-col gap-2',
    groupLabel: 'meta',
    other: 'grid grid-cols-1 gap-x-4 gap-y-1 @sm:grid-cols-2',
    otherRow: 'meta-value flex min-w-0 items-baseline gap-2',
    otherKey: 'shrink-0 text-muted',
    otherValue: 'truncate text-foreground',
  },
})

export interface DocumentPropertiesProps {
  /** The draft's front matter record, exactly as it is stored. */
  readonly frontMatter: Readonly<Record<string, unknown>>
  /** The document's first heading, which is its title when none is declared. */
  readonly headingTitle?: string | undefined
  readonly editable?: boolean
  /** Open on first render. Off by default: the body is what an author came for. */
  readonly defaultOpen?: boolean
  readonly className?: string | undefined
  /** The whole record, with one value changed. Never a patch: order matters. */
  onChange(frontMatter: Record<string, unknown>): void
}

export function DocumentProperties({
  frontMatter,
  headingTitle,
  editable = true,
  defaultOpen = false,
  className,
  onChange,
}: DocumentPropertiesProps) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  const styles = documentPropertiesStyles()

  const model = readProperties(frontMatter, { headingTitle })
  const summary = summarise(frontMatter)

  function edit(field: PropertyField, raw: string): void {
    onChange(writeProperty(frontMatter, field, raw))
  }

  const chips = [
    ...(summary.type === undefined ? [] : [{ key: `type:${summary.type}`, label: summary.type }]),
    ...summary.owners.map((owner) => ({ key: `owner:${owner}`, label: owner })),
    ...summary.tags.map((tag) => ({ key: `tag:${tag}`, label: `#${tag}` })),
  ]
  const nothingSet = summary.status === undefined && chips.length === 0

  return (
    <section aria-label="Document properties" className={styles.root({ className })}>
      <div className={styles.strip()}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          className={styles.toggle()}
          onClick={() => {
            setOpen(!open)
          }}
        >
          <ChevronRightIcon className={styles.chevron()} />
          Properties
        </button>

        <ul aria-label="Summary" className={styles.chips()} hidden={open}>
          {summary.status === undefined ? undefined : (
            <li>
              <Badge tone="accent">{humanise(summary.status)}</Badge>
            </li>
          )}
          {chips.map((chip) => (
            <li key={chip.key} className={styles.chip()}>
              {chip.label}
            </li>
          ))}
          {nothingSet ? <li className={styles.empty()}>Nothing set yet</li> : undefined}
        </ul>
      </div>

      <div id={panelId} hidden={!open} className={styles.panel()}>
        <div className={styles.grid()}>
          {model.fields.map((field) => (
            <Field key={field.key} field={field} editable={editable} onEdit={edit} />
          ))}
        </div>

        {model.questions.length === 0 ? undefined : (
          <div role="group" aria-labelledby={`${panelId}-questions`} className={styles.group()}>
            <p id={`${panelId}-questions`} className={styles.groupLabel()}>
              Template questions
            </p>
            <div className={styles.grid()}>
              {model.questions.map((field) => (
                <Field key={field.key} field={field} editable={editable} onEdit={edit} />
              ))}
            </div>
          </div>
        )}

        {model.other.length === 0 ? undefined : (
          <div role="group" aria-labelledby={`${panelId}-other`} className={styles.group()}>
            {/* Not a heading: these labels group a form, and a document being
                written already has an outline of its own to keep clean. */}
            <p id={`${panelId}-other`} className={styles.groupLabel()}>
              Other fields
            </p>
            <dl className={styles.other()}>
              {model.other.map((entry) => (
                <div key={entry.key} className={styles.otherRow()}>
                  <dt className={styles.otherKey()}>{entry.key}</dt>
                  <dd className={styles.otherValue()}>{entry.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </section>
  )
}

interface FieldProps {
  readonly field: PropertyField
  readonly editable: boolean
  onEdit(field: PropertyField, raw: string): void
}

/**
 * One row of the form. Which control a field gets is the field's `kind`, which
 * the model decided from the schema and from the template's declaration, so
 * this component chooses nothing and can be read top to bottom.
 *
 * A text field holds the text being typed itself, and lets go of it when the
 * document hands it a different value. Without that, a round trip through the
 * record eats every character that does not survive it — the comma between two
 * tags, the space between two words — the instant it is pressed.
 */
function Field({ field, editable, onEdit }: FieldProps) {
  const [typed, setTyped] = useState({ text: field.value, from: field.value })
  if (field.value !== typed.from) setTyped({ text: field.value, from: field.value })

  if (field.kind === 'readonly') {
    return (
      <PropertyReadout label={field.label} description={field.help}>
        {field.value === '' ? 'Not set' : field.value}
      </PropertyReadout>
    )
  }

  if (field.kind === 'select') {
    return (
      <PropertySelect
        label={field.label}
        value={field.value}
        // Every `select` field `readProperties` builds sets `options`; the
        // fallback only keeps this read total against the wider optional type.
        /* v8 ignore next */
        options={field.options ?? []}
        description={field.help}
        error={field.error}
        disabled={!editable}
        onChange={(event) => {
          onEdit(field, event.target.value)
        }}
      />
    )
  }

  return (
    <Input
      label={field.label}
      type={field.kind === 'date' ? 'date' : 'text'}
      value={typed.text}
      disabled={!editable}
      {...(field.help === undefined ? {} : { description: field.help })}
      {...(field.error === undefined ? {} : { error: field.error })}
      onChange={(event) => {
        setTyped({ text: event.target.value, from: field.value })
        onEdit(field, event.target.value)
      }}
    />
  )
}
