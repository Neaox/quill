import { useEffect, useId, useState, type ReactNode } from 'react'

import { tv } from '../lib/class-names.ts'

/**
 * The grouped listbox behind every editable combobox in the design system —
 * the command palette's and the `Combobox` field's — and the cursor that walks
 * it.
 *
 * **Focus stays in the field.** The arrows move `aria-activedescendant`
 * through the options while the text box keeps focus, so somebody types a few
 * letters and presses Enter without leaving it, and Tab stays a way out rather
 * than a walk through every result. That is why each option has
 * `tabIndex={-1}`, and why Home and End are not the list's: in an editable
 * combobox they move the caret, as in any other text box.
 */

export const listboxStyles = tv({
  slots: {
    list: 'flex flex-col gap-1 overflow-y-auto',
    group: 'flex flex-col gap-0.5',
    groupLabel: 'px-2 pt-2 pb-1 text-2xs font-medium tracking-wide text-muted uppercase',
    option: [
      'flex w-full cursor-pointer flex-col items-start gap-1 rounded-md px-2 py-2 text-start',
      'text-sm text-foreground hover:bg-surface/60 aria-selected:bg-surface',
    ],
    optionLabel: 'w-full truncate font-medium',
    optionDetail: 'flex w-full min-w-0 flex-col gap-1',
  },
})

export interface ListboxOption {
  /** What `onSelect` is given. Unique across every group. */
  readonly id: string
  /**
   * What this option is *called*: one short phrase, and the whole of its
   * accessible name.
   *
   * The split between this and `detail` is the point of the two fields. An
   * option whose name is its title plus three lines of matched text is read
   * out in full every time the arrow keys land on it, and two rows that begin
   * with different titles are then indistinguishable to anybody choosing by
   * ear — which is also why `getByRole('option', { name })` cannot tell them
   * apart. The name is the title; everything else describes it.
   */
  readonly label: ReactNode
  /**
   * The rest of the row — a snippet, a trail — shown beneath the label and
   * attached to the option as its description rather than its name.
   */
  readonly detail?: ReactNode | undefined
}

export interface ListboxGroup {
  readonly id: string
  /** Names the group for sight and for assistive technology alike. */
  readonly label: string
  readonly options: readonly ListboxOption[]
}

/** One option, with its place in the flattened list the arrow keys walk. */
interface PositionedOption extends ListboxOption {
  readonly position: number
}

interface PositionedGroup extends Omit<ListboxGroup, 'options'> {
  readonly options: readonly PositionedOption[]
}

/**
 * The groups as they are rendered, plus the flat list of ids behind them.
 *
 * Grouping is how results are read and a single sequence is how they are
 * walked, so both are produced in one pass here rather than the renderer
 * searching the flat list for each row it draws.
 */
export function positionOptions(groups: readonly ListboxGroup[]): {
  readonly groups: readonly PositionedGroup[]
  readonly ids: readonly string[]
} {
  const ids: string[] = []
  const positioned = groups.map((group) => ({
    ...group,
    options: group.options.map((option) => ({ ...option, position: ids.push(option.id) - 1 })),
  }))
  return { groups: positioned, ids }
}

export interface ListboxCursor {
  readonly groups: readonly PositionedGroup[]
  /** How many options there are, across every group. */
  readonly size: number
  /** The element id of the active option, for the field's `aria-activedescendant`. */
  readonly activeId: string | undefined
  /** The listbox's element id, for the field's `aria-controls`. */
  readonly listId: string
  readonly idPrefix: string
  readonly active: number
  /** Moves the active option by `by`, stopping at either end. */
  readonly move: (by: number) => void
  /** Back to the first option: what typing does, since the list it pointed into is replaced. */
  readonly reset: () => void
  /** The id of the active option, or undefined when there is none. */
  readonly activeOption: () => string | undefined
}

export interface ListboxCursorOptions {
  /**
   * Whether the first option is active before the arrows are used. On by
   * default, which suits a list that is the answer (a palette, where Enter
   * opens the top result). Off suits suggestions beside a field whose own Enter
   * means something else, such as submitting a search: nothing is chosen until
   * the arrows reach it.
   */
  readonly preselect?: boolean
}

/**
 * Which option the arrows have reached, and the ids that wire the field to it.
 *
 * The active position is *derived* rather than corrected in an effect:
 * results that arrive shorter than the list they replace move the active
 * option to the new end on the very render that shortened it.
 */
export function useListboxCursor(
  groups: readonly ListboxGroup[],
  { preselect = true }: ListboxCursorOptions = {},
): ListboxCursor {
  const idPrefix = useId()
  // `-1` is "none yet": the arrows have not been used, so Enter is still the
  // field's own (a form's submit) rather than a choice nobody made.
  const first = preselect ? 0 : -1
  const [wanted, setWanted] = useState(first)
  const { groups: rows, ids } = positionOptions(groups)
  const active = ids.length === 0 ? -1 : Math.min(wanted, ids.length - 1)
  const activeId = active === -1 ? undefined : `${idPrefix}-option-${active}`

  /* Synchronises with the list's scroll position, which React does not
     render: moving through `aria-activedescendant` scrolls nothing on its
     own, because nothing is focused but the field. */
  useEffect(() => {
    if (activeId === undefined) return
    document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  return {
    groups: rows,
    size: ids.length,
    activeId,
    listId: `${idPrefix}-list`,
    idPrefix,
    active,
    move: (by) => {
      if (ids.length === 0) return
      setWanted(Math.min(ids.length - 1, Math.max(0, active + by)))
    },
    reset: () => {
      setWanted(first)
    },
    activeOption: () => ids[active],
  }
}

export interface GroupedListboxProps {
  readonly cursor: ListboxCursor
  /** The listbox's accessible name. */
  readonly label: string
  readonly onSelect: (optionId: string) => void
  /** Sizing for the list itself, which depends on what it sits in. */
  readonly className?: string | undefined
}

/** The listbox a cursor walks: labelled groups of options, the active one selected. */
export function GroupedListbox({ cursor, label, onSelect, className }: GroupedListboxProps) {
  const styles = listboxStyles()
  const { idPrefix } = cursor
  return (
    <div
      id={cursor.listId}
      role="listbox"
      aria-label={label}
      className={styles.list({ className })}
    >
      {cursor.groups.map((group) => (
        <div
          key={group.id}
          role="group"
          aria-labelledby={`${idPrefix}-group-${group.id}`}
          className={styles.group()}
        >
          <p id={`${idPrefix}-group-${group.id}`} className={styles.groupLabel()}>
            {group.label}
          </p>
          {group.options.map((option) => (
            <button
              key={option.id}
              id={`${idPrefix}-option-${option.position}`}
              type="button"
              role="option"
              // Not a tab stop: the field keeps focus and moves
              // `aria-activedescendant` instead, so Tab remains a way out
              // rather than a walk through every result.
              tabIndex={-1}
              aria-selected={option.position === cursor.active}
              // The name is the label's own text, not the row's: pointing at
              // the element keeps the accessible name and the visible words
              // identical (WCAG 2.5.3), which an `aria-label` restating the
              // title would only promise.
              aria-labelledby={`${idPrefix}-label-${option.position}`}
              {...(option.detail === undefined
                ? {}
                : { 'aria-describedby': `${idPrefix}-detail-${option.position}` })}
              // A press must not take focus from the field first: the field
              // is what the person is typing into, and a combobox that closes
              // on blur would otherwise close before the press landed.
              onMouseDown={(event) => {
                event.preventDefault()
              }}
              onClick={() => {
                onSelect(option.id)
              }}
              className={styles.option()}
            >
              <span id={`${idPrefix}-label-${option.position}`} className={styles.optionLabel()}>
                {option.label}
              </span>
              {option.detail === undefined ? undefined : (
                <span
                  id={`${idPrefix}-detail-${option.position}`}
                  className={styles.optionDetail()}
                >
                  {option.detail}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
