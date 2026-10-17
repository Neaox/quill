import { AnchoredPopover, Input, inputStyles, tv } from '@quill/ui'
import type { PopoverAnchor } from '@quill/ui'
import { CHILD_PAGES_DEPTHS, CHILD_PAGES_SORTS, HEADING_LEVELS } from '@quill/markdown'
import type {
  ChildPagesBlock,
  ChildPagesSort,
  HeadingLevel,
  TableOfContents,
} from '@quill/markdown'
import { useId, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react'

/**
 * The settings of a navigation block (ADR-056), in a small panel held
 * against its Settings button. Every choice is written at once, as one
 * change the author can undo; the title is written when the field is left
 * or Enter is pressed, so typing a title is one step of undo, not one per
 * letter.
 */

const styles = tv({
  slots: {
    form: 'flex flex-col gap-3',
    row: 'grid grid-cols-2 gap-2',
    select: '',
    check: 'flex items-center gap-2 text-xs text-foreground',
    box: 'size-4 accent-[var(--color-accent)]',
    legend: 'mb-1 text-xs font-medium text-foreground',
    choices: 'flex gap-3',
  },
})()

const field = inputStyles()

function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string
  readonly value: T
  readonly options: readonly { readonly value: T; readonly label: string }[]
  onChange(value: T): void
}) {
  const id = useId()
  return (
    <div className={field.root()}>
      <label htmlFor={id} className={field.label()}>
        {label}
      </label>
      <select
        id={id}
        className={field.control()}
        value={String(value)}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
          const chosen = options.find((option) => String(option.value) === event.target.value)
          /* v8 ignore next -- the control offers only these options. */
          if (chosen !== undefined) onChange(chosen.value)
        }}
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function CheckField({
  label,
  checked,
  onChange,
}: {
  readonly label: string
  readonly checked: boolean
  onChange(checked: boolean): void
}) {
  return (
    <label className={styles.check()}>
      <input
        type="checkbox"
        className={styles.box()}
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked)
        }}
      />
      {label}
    </label>
  )
}

/** The optional title, written when the field is left or Enter is pressed. */
function TitleField({
  title,
  placeholder,
  onCommit,
}: {
  readonly title: string | undefined
  readonly placeholder: string
  onCommit(title: string | undefined): void
}) {
  const [draft, setDraft] = useState(title ?? '')
  const commit = (): void => {
    const trimmed = draft.trim()
    if (trimmed !== (title ?? '')) onCommit(trimmed === '' ? undefined : trimmed)
  }
  return (
    <Input
      label="Title"
      description="Optional. Shown above the list, and names it."
      placeholder={placeholder}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value)
      }}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
      }}
    />
  )
}

const LEVEL_OPTIONS = HEADING_LEVELS.map((level) => ({
  value: level,
  label: `Heading ${String(level)}`,
}))

export interface TableOfContentsSettingsProps {
  readonly model: TableOfContents
  onChange(model: TableOfContents): void
}

export function TableOfContentsSettings({ model, onChange }: TableOfContentsSettingsProps) {
  const numbering = useId()
  const levels = (from: HeadingLevel, to: HeadingLevel): void => {
    // A range is read either way round; it is written lowest first.
    onChange({ ...model, levels: from <= to ? { from, to } : { from: to, to: from } })
  }
  return (
    <div className={styles.form()}>
      <TitleField
        title={model.title}
        placeholder="On this page"
        onCommit={(title) => {
          onChange({ ...model, title })
        }}
      />
      <div className={styles.row()}>
        <SelectField
          label="From"
          value={model.levels.from}
          options={LEVEL_OPTIONS}
          onChange={(from) => {
            levels(from, model.levels.to)
          }}
        />
        <SelectField
          label="To"
          value={model.levels.to}
          options={LEVEL_OPTIONS}
          onChange={(to) => {
            levels(model.levels.from, to)
          }}
        />
      </div>
      <fieldset>
        <legend id={numbering} className={styles.legend()}>
          Numbering
        </legend>
        <div className={styles.choices()}>
          {(['bulleted', 'numbered'] as const).map((style) => (
            <label key={style} className={styles.check()}>
              <input
                type="radio"
                name={numbering}
                className={styles.box()}
                checked={model.style === style}
                onChange={() => {
                  onChange({ ...model, style })
                }}
              />
              {style === 'bulleted' ? 'Bulleted' : 'Numbered'}
            </label>
          ))}
        </div>
      </fieldset>
      <CheckField
        label="Fold subsections"
        checked={model.collapsed}
        onChange={(collapsed) => {
          onChange({ ...model, collapsed })
        }}
      />
    </div>
  )
}

const SORT_LABELS: Readonly<Record<ChildPagesSort, string>> = {
  manual: 'Navigation order',
  title: 'Title',
  updated: 'Recently updated',
}

export interface ChildPagesSettingsProps {
  readonly model: ChildPagesBlock
  onChange(model: ChildPagesBlock): void
}

export function ChildPagesSettings({ model, onChange }: ChildPagesSettingsProps) {
  return (
    <div className={styles.form()}>
      <TitleField
        title={model.title}
        placeholder="In this section"
        onCommit={(title) => {
          onChange({ ...model, title })
        }}
      />
      <div className={styles.row()}>
        <SelectField
          label="Levels deep"
          value={model.depth}
          options={CHILD_PAGES_DEPTHS.map((depth) => ({ value: depth, label: String(depth) }))}
          onChange={(depth) => {
            onChange({ ...model, depth })
          }}
        />
        <SelectField
          label="Order"
          value={model.sort}
          options={CHILD_PAGES_SORTS.map((sort) => ({ value: sort, label: SORT_LABELS[sort] }))}
          onChange={(sort) => {
            onChange({ ...model, sort })
          }}
        />
      </div>
      <CheckField
        label="Show summaries"
        checked={model.excerpts}
        onChange={(excerpts) => {
          onChange({ ...model, excerpts })
        }}
      />
      <CheckField
        label="Show icons"
        checked={model.icons}
        onChange={(icons) => {
          onChange({ ...model, icons })
        }}
      />
    </div>
  )
}

export interface NavigationSettingsPanelProps {
  readonly open: boolean
  readonly anchor: PopoverAnchor
  readonly label: string
  readonly children?: ReactNode
  /** The region it stays inside: the page's main region, clear of the sidebar. */
  readonly boundary?: Element | null | undefined
  onOpenChange(open: boolean): void
  onCloseFocus(): void
}

/**
 * The panel itself: a popover hung from the block's Settings button, which
 * sits at the block's end, so it lines up with that end and opens over the
 * block rather than out to the edge of the screen.
 */
export function NavigationSettingsPanel({
  open,
  anchor,
  label,
  children,
  boundary,
  onOpenChange,
  onCloseFocus,
}: NavigationSettingsPanelProps) {
  return (
    <AnchoredPopover
      open={open}
      anchor={anchor}
      label={label}
      align="end"
      boundary={boundary}
      onOpenChange={onOpenChange}
      onCloseFocus={onCloseFocus}
    >
      {children}
    </AnchoredPopover>
  )
}
