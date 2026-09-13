import { useId, type ReactNode } from 'react'

import { tv } from '@quill/ui'

import type { LayoutSettings } from '../../lib/api/index.ts'

/**
 * ADR-028's bounded set of signature variants, as a settings screen offers
 * them.
 *
 * The set is bounded on purpose — "adding to it is a design decision, not a
 * CSS tweak" — so it is written here as data, once, and both the
 * organisation's default and a workspace's override render from it. Each
 * option carries the sentence that says what choosing it does, because
 * somebody picking "sidenotes" over "panel" is choosing where their
 * colleagues' comments will appear, not a word.
 *
 * Each axis also carries its own `apply`, which narrows a chosen string to
 * that axis's union and **refuses anything outside it**, mirroring the server
 * ("a value outside the set is a `400`, not a warning"). That is why there is
 * no type assertion anywhere here: the bounded set is spelled out once per
 * axis and the compiler checks each spelling, while `layout-choices.test.tsx`
 * holds every `apply` to its own option list so the two cannot drift.
 *
 * The illustrations are schematic: a few rectangles in the current palette
 * showing where things sit. They are decorative — the label and its
 * description carry the meaning — so each is `aria-hidden`, and the screen
 * reads correctly with images off.
 */

export type LayoutKey = keyof LayoutSettings

export interface LayoutOption {
  readonly value: string
  readonly label: string
  readonly description: string
  readonly illustration: ReactNode
}

export interface LayoutAxis {
  readonly key: LayoutKey
  readonly legend: string
  readonly description: string
  readonly options: readonly LayoutOption[]
  /** Applies a chosen option; returns the layout unchanged for a value outside the set. */
  readonly apply: (layout: LayoutSettings, value: string) => LayoutSettings
}

/** A schematic of one arrangement: panes drawn as filled rectangles. */
function Sketch({ children }: { readonly children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 64 40"
      className="h-10 w-16 shrink-0 rounded-sm border border-border bg-surface"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

const PANE = 'fill-border'
const MARK = 'fill-accent'
const LINE = 'fill-border-strong'

export const LAYOUT_AXES: readonly LayoutAxis[] = [
  {
    key: 'navigation',
    legend: 'Navigation',
    description: 'How this workspace’s documents are listed in the sidebar.',
    apply: (layout, value) =>
      value === 'tree' || value === 'tabs' ? { ...layout, navigation: value } : layout,
    options: [
      {
        value: 'tree',
        label: 'Tree',
        description: 'A plain, nested list of collections and documents.',
        illustration: (
          <Sketch>
            <rect x="4" y="6" width="18" height="3" className={LINE} />
            <rect x="8" y="13" width="14" height="3" className={PANE} />
            <rect x="8" y="20" width="14" height="3" className={PANE} />
            <rect x="4" y="27" width="18" height="3" className={LINE} />
            <rect x="28" y="6" width="32" height="24" className={PANE} />
          </Sketch>
        ),
      },
      {
        value: 'tabs',
        label: 'Collection tabs',
        description: 'Collections across the top, each in its own colour.',
        illustration: (
          <Sketch>
            <rect x="4" y="6" width="12" height="4" className={MARK} />
            <rect x="19" y="6" width="12" height="4" className={PANE} />
            <rect x="34" y="6" width="12" height="4" className={PANE} />
            <rect x="4" y="14" width="56" height="16" className={PANE} />
          </Sketch>
        ),
      },
    ],
  },
  {
    key: 'comments',
    legend: 'Comments',
    description: 'Where comments and provenance sit beside a document.',
    apply: (layout, value) =>
      value === 'panel' || value === 'sidenotes' ? { ...layout, comments: value } : layout,
    options: [
      {
        value: 'panel',
        label: 'Side panel',
        description: 'One column at the edge, holding every comment on the document.',
        illustration: (
          <Sketch>
            <rect x="4" y="6" width="34" height="24" className={PANE} />
            <rect x="42" y="6" width="18" height="24" className={LINE} />
          </Sketch>
        ),
      },
      {
        value: 'sidenotes',
        label: 'Sidenotes',
        description: 'Each comment in the margin, level with the line it is about.',
        illustration: (
          <Sketch>
            <rect x="4" y="6" width="34" height="3" className={PANE} />
            <rect x="4" y="12" width="34" height="3" className={PANE} />
            <rect x="42" y="12" width="18" height="6" className={LINE} />
            <rect x="4" y="21" width="34" height="3" className={PANE} />
            <rect x="42" y="24" width="18" height="6" className={LINE} />
          </Sketch>
        ),
      },
    ],
  },
  {
    key: 'history',
    legend: 'History',
    description: 'How a document’s revisions are reached.',
    apply: (layout, value) =>
      value === 'timeline' || value === 'menu' ? { ...layout, history: value } : layout,
    options: [
      {
        value: 'timeline',
        label: 'Timeline',
        description: 'Revisions laid out down the page, with who changed what.',
        illustration: (
          <Sketch>
            <rect x="10" y="6" width="2" height="24" className={LINE} />
            <circle cx="11" cy="11" r="3" className={MARK} />
            <circle cx="11" cy="20" r="3" className={PANE} />
            <circle cx="11" cy="28" r="3" className={PANE} />
            <rect x="18" y="9" width="32" height="3" className={PANE} />
            <rect x="18" y="18" width="26" height="3" className={PANE} />
          </Sketch>
        ),
      },
      {
        value: 'menu',
        label: 'Menu',
        description: 'A compact list behind one control in the header.',
        illustration: (
          <Sketch>
            <rect x="44" y="5" width="16" height="5" className={MARK} />
            <rect x="40" y="13" width="20" height="4" className={PANE} />
            <rect x="40" y="19" width="20" height="4" className={PANE} />
            <rect x="4" y="5" width="30" height="25" className={PANE} />
          </Sketch>
        ),
      },
    ],
  },
  {
    key: 'header',
    legend: 'Header',
    description: 'What the bar above a document says.',
    apply: (layout, value) =>
      value === 'readout' || value === 'breadcrumb' ? { ...layout, header: value } : layout,
    options: [
      {
        value: 'readout',
        label: 'Status readout',
        description: 'The document’s state and when it last changed, as facts.',
        illustration: (
          <Sketch>
            <rect x="4" y="7" width="20" height="4" className={LINE} />
            <rect x="28" y="7" width="10" height="4" className={MARK} />
            <rect x="42" y="7" width="18" height="4" className={PANE} />
            <rect x="4" y="17" width="56" height="13" className={PANE} />
          </Sketch>
        ),
      },
      {
        value: 'breadcrumb',
        label: 'Breadcrumb bar',
        description: 'The path down to this document, as links.',
        illustration: (
          <Sketch>
            <rect x="4" y="7" width="12" height="4" className={PANE} />
            <rect x="19" y="7" width="12" height="4" className={PANE} />
            <rect x="34" y="7" width="16" height="4" className={LINE} />
            <rect x="4" y="17" width="56" height="13" className={PANE} />
          </Sketch>
        ),
      },
    ],
  },
  {
    key: 'rules',
    legend: 'Dividers',
    description: 'How sections of a document are separated.',
    apply: (layout, value) =>
      value === 'double' || value === 'hairline' || value === 'cards'
        ? { ...layout, rules: value }
        : layout,
    options: [
      {
        value: 'hairline',
        label: 'Hairlines',
        description: 'One thin rule between sections.',
        illustration: (
          <Sketch>
            <rect x="6" y="9" width="52" height="3" className={PANE} />
            <rect x="6" y="19" width="52" height="1" className={LINE} />
            <rect x="6" y="26" width="52" height="3" className={PANE} />
          </Sketch>
        ),
      },
      {
        value: 'double',
        label: 'Double rules',
        description: 'Two rules, the editorial treatment.',
        illustration: (
          <Sketch>
            <rect x="6" y="9" width="52" height="3" className={PANE} />
            <rect x="6" y="18" width="52" height="1" className={LINE} />
            <rect x="6" y="21" width="52" height="1" className={LINE} />
            <rect x="6" y="27" width="52" height="3" className={PANE} />
          </Sketch>
        ),
      },
      {
        value: 'cards',
        label: 'Cards',
        description: 'Each section on its own raised surface.',
        illustration: (
          <Sketch>
            <rect x="6" y="6" width="52" height="12" rx="2" className={PANE} />
            <rect x="6" y="22" width="52" height="12" rx="2" className={PANE} />
          </Sketch>
        ),
      },
    ],
  },
]

const layoutChoice = tv({
  slots: {
    root: 'flex flex-col gap-2 border-0 p-0',
    legend: 'text-sm font-medium text-foreground',
    hint: 'text-xs text-muted',
    list: 'mt-1 flex flex-wrap gap-2',
    option: 'relative flex',
    input: 'peer absolute inset-0 z-10 m-0 cursor-pointer appearance-none opacity-0',
    label: [
      'flex w-60 cursor-pointer items-start gap-2.5 rounded-md border border-border p-3',
      'transition-colors hover:border-border-strong',
      'peer-checked:border-accent peer-checked:bg-surface',
      'peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
      'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
      'peer-focus-visible:outline-focus-ring',
    ],
    name: 'block text-xs font-medium text-foreground',
    description: 'mt-0.5 block text-2xs leading-normal text-muted',
  },
})

export interface LayoutChoiceProps {
  readonly axis: LayoutAxis
  readonly value: string
  readonly onValueChange: (value: string) => void
  /** The organisation locked layout: the choice is shown, and refused. */
  readonly disabled?: boolean
  /** Distinguishes two groups for the same axis on one screen. */
  readonly groupName?: string
}

/**
 * One axis as a radio group: native radios, so the group is one tab stop and
 * the arrow keys move between the options, with the selected state carried by
 * `:checked` and the appearance following it through `peer-checked:` — no
 * branch here decides a colour (`docs/architecture/styling.md`).
 *
 * `disabled` is the locked case, and the radios really are disabled rather
 * than hidden: the workspace is shown the arrangement it has and told who
 * decided it, which is more use than an empty panel.
 */
export function LayoutChoice({
  axis,
  value,
  onValueChange,
  disabled = false,
  groupName,
}: LayoutChoiceProps) {
  const generated = useId()
  const name = groupName ?? `${generated}-${axis.key}`
  const hintId = `${generated}-${axis.key}-hint`
  const styles = layoutChoice()

  return (
    // The sentence under the legend is what the group is *for*, so it is
    // pointed at rather than left to document order: a screen reader announces
    // the group's name and its description together on entry.
    <fieldset className={styles.root()} disabled={disabled} aria-describedby={hintId}>
      <legend className={styles.legend()}>{axis.legend}</legend>
      <p id={hintId} className={styles.hint()}>
        {axis.description}
      </p>
      <div className={styles.list()}>
        {axis.options.map((option) => {
          const id = `${name}-${option.value}`
          return (
            <div key={option.value} className={styles.option()}>
              <input
                type="radio"
                id={id}
                name={name}
                value={option.value}
                checked={option.value === value}
                onChange={() => {
                  onValueChange(option.value)
                }}
                className={styles.input()}
              />
              <label htmlFor={id} className={styles.label()}>
                {option.illustration}
                <span>
                  <span className={styles.name()}>{option.label}</span>
                  <span className={styles.description()}>{option.description}</span>
                </span>
              </label>
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}

export interface LayoutChoicesProps {
  readonly layout: LayoutSettings
  readonly onLayoutChange: (layout: LayoutSettings) => void
  readonly disabled?: boolean
  /** Prefixes each radio group's name, so two sets of these can share a page. */
  readonly groupPrefix?: string
}

/** Every axis, in the order ADR-028 lists them. */
export function LayoutChoices({
  layout,
  onLayoutChange,
  disabled = false,
  groupPrefix,
}: LayoutChoicesProps) {
  return (
    <div className="flex flex-col gap-6">
      {LAYOUT_AXES.map((axis) => (
        <LayoutChoice
          key={axis.key}
          axis={axis}
          value={layout[axis.key]}
          disabled={disabled}
          {...(groupPrefix === undefined ? {} : { groupName: `${groupPrefix}-${axis.key}` })}
          onValueChange={(next) => {
            onLayoutChange(axis.apply(layout, next))
          }}
        />
      ))}
    </div>
  )
}

/** The chosen option's label for one axis, for a readout of a layout in words. */
export function layoutOptionLabel(key: LayoutKey, value: string): string {
  const axis = LAYOUT_AXES.find((candidate) => candidate.key === key)
  return axis?.options.find((option) => option.value === value)?.label ?? value
}

/** A whole layout in words, for a conflict notice or a locked readout. */
export function describeLayout(layout: LayoutSettings): string {
  return LAYOUT_AXES.map(
    (axis) => `${axis.legend}: ${layoutOptionLabel(axis.key, layout[axis.key])}`,
  ).join(', ')
}
