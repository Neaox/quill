import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Dialog as Primitive, VisuallyHidden } from 'radix-ui'

import { tv } from '../lib/class-names.ts'
import { SearchIcon } from './icons.tsx'
import { Spinner } from './spinner.tsx'

/**
 * The panel's entrance is not here: `.command-palette-panel` in `tokens.css`
 * keys it on Radix's own `data-state`, beside the dialog's keyframes and the
 * reduced-motion rule that neutralises every one of them, so the resting
 * position and the animation are stated once and cannot disagree.
 */
export const commandPaletteStyles = tv({
  slots: {
    overlay: 'dialog-overlay fixed inset-0 z-40 bg-overlay',
    panel: [
      'command-palette-panel fixed top-16 left-1/2 z-50 sm:top-24',
      'w-[min(40rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface-raised',
      'shadow-dialog flex max-h-[min(32rem,calc(100dvh-8rem))] flex-col overflow-hidden',
    ],
    search: [
      'flex shrink-0 items-center gap-2.5 border-b border-border px-3.5',
      'text-muted aria-busy:cursor-progress',
    ],
    field: [
      'h-12 w-full min-w-0 bg-transparent text-sm text-foreground',
      'placeholder:text-muted/75 focus-visible:outline-hidden',
    ],
    list: 'flex min-h-0 grow flex-col gap-1 overflow-y-auto p-2',
    group: 'flex flex-col gap-0.5',
    groupLabel: 'px-2 pt-2 pb-1 text-2xs font-medium tracking-wide text-muted uppercase',
    option: [
      'flex w-full cursor-pointer flex-col items-start gap-1 rounded-md px-2 py-2 text-start',
      'text-sm text-foreground hover:bg-surface/60 aria-selected:bg-surface',
    ],
    optionLabel: 'w-full truncate font-medium',
    optionDetail: 'flex w-full min-w-0 flex-col gap-1',
    notice: 'min-h-0 grow overflow-y-auto px-4 py-6 text-sm text-muted',
    footer: 'flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-2',
  },
})

export interface CommandPaletteOption {
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

export interface CommandPaletteGroup {
  readonly id: string
  /** Names the group for sight and for assistive technology alike. */
  readonly label: string
  readonly options: readonly CommandPaletteOption[]
}

export interface CommandPaletteProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The dialog's accessible name. */
  readonly title: string
  /** The field's label. Visually hidden: the icon and the placeholder are the visible form. */
  readonly inputLabel: string
  /** Controlled, because what was typed is the caller's query. */
  readonly value: string
  readonly onValueChange: (value: string) => void
  readonly placeholder?: string | undefined
  /** Help wired into the field's `aria-describedby`, such as what Enter does. */
  readonly description?: string | undefined
  readonly groups: readonly CommandPaletteGroup[]
  readonly onSelect: (optionId: string) => void
  /** An answer is on the way: the field reads busy and shows a spinner. */
  readonly busy?: boolean | undefined
  /** Shown in place of the list — an empty state, or a query that would not parse. */
  readonly notice?: ReactNode | undefined
  /** The foot of the panel: "See all results", a hint about the keys. */
  readonly footer?: ReactNode | undefined
  /**
   * What has just been answered, in a sentence, for a screen reader.
   *
   * Focus never leaves the field here, so nothing about the list is spoken on
   * its own: `aria-activedescendant` speaks only when the arrows move it, and
   * eight results replacing three is otherwise silent. This is announced
   * politely when it changes, so the caller passes the *settled* answer —
   * "8 results" — and nothing at all while one is still on the way, which is
   * what keeps it from chattering at every keystroke.
   */
  readonly status?: string | undefined
}

/** One option, with its place in the flattened list the arrow keys walk. */
interface PositionedOption extends CommandPaletteOption {
  readonly position: number
}

interface PositionedGroup extends Omit<CommandPaletteGroup, 'options'> {
  readonly options: readonly PositionedOption[]
}

/**
 * The groups as they are rendered, plus the flat list of ids behind them.
 *
 * Grouping is how results are read and a single sequence is how they are
 * walked, so both are produced in one pass here rather than the renderer
 * searching the flat list for each row it draws.
 */
export function positionOptions(groups: readonly CommandPaletteGroup[]): {
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

/**
 * The command palette: a field over a grouped list, in a modal dialog.
 *
 * **Combobox and listbox, not a list of buttons.** The field keeps focus while
 * the arrows move `aria-activedescendant` through the options, so somebody
 * types a few letters and presses Enter without ever leaving it, and Tab stays
 * a way out of the panel rather than a walk through fifty results. That is the
 * whole reason the options carry `tabIndex={-1}`.
 *
 * Closed, it renders nothing: the active option is the palette's own state,
 * and mounting it fresh is what makes every opening start at the top of the
 * list rather than wherever the last one was left.
 *
 * Focus trapping, Escape, the inert background and the return of focus to
 * whatever opened it are Radix's, for the same reason `Dialog` delegates them
 * — this layer owns the API, the classes and the states, and none of the
 * machinery a screen reader depends on is hand-rolled.
 */
export function CommandPalette({ open, onOpenChange, ...panel }: CommandPaletteProps) {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      {open ? <Panel {...panel} /> : undefined}
    </Primitive.Root>
  )
}

type PanelProps = Omit<CommandPaletteProps, 'open' | 'onOpenChange'>

function Panel({
  title,
  inputLabel,
  value,
  onValueChange,
  placeholder,
  description,
  groups,
  onSelect,
  busy = false,
  notice,
  footer,
  status,
}: PanelProps) {
  const ids = useId()
  const field = useRef<HTMLInputElement | null>(null)
  const [wanted, setWanted] = useState(0)

  const { groups: rows, ids: optionIds } = positionOptions(groups)
  // Derived rather than corrected in an effect: results that arrive shorter
  // than the list they replace move the active option to the new end on the
  // very render that shortened it.
  const active = optionIds.length === 0 ? -1 : Math.min(wanted, optionIds.length - 1)
  const activeId = active === -1 ? undefined : `${ids}-option-${active}`
  const listId = `${ids}-list`
  const descriptionId = `${ids}-description`

  /* Synchronises with the list's scroll position, which React does not
     render: moving through `aria-activedescendant` scrolls nothing on its
     own, because nothing is focused but the field. */
  useEffect(() => {
    if (activeId === undefined) return
    field.current?.ownerDocument.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  const styles = commandPaletteStyles()

  function move(by: number): void {
    if (optionIds.length === 0) return
    setWanted(Math.min(optionIds.length - 1, Math.max(0, active + by)))
  }

  function choose(): void {
    const chosen = optionIds[active]
    if (chosen !== undefined) onSelect(chosen)
  }

  /**
   * The keys the list owns, and only those.
   *
   * Escape is deliberately absent: it belongs to the dialog, and Radix already
   * closes on it, so answering it here would be a second answer to one key.
   * **Home and End are deliberately absent too.** This is an *editable*
   * combobox whose text field never gives up focus, so those two keys are the
   * caret's — moving it to the start or the end of the query — exactly as they
   * are in any other text box. A listbox claims them only when the listbox
   * itself has focus, which by design this one never does.
   */
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') move(1)
    else if (event.key === 'ArrowUp') move(-1)
    else if (event.key === 'Enter') choose()
    else return
    event.preventDefault()
  }

  return (
    <Primitive.Portal>
      <Primitive.Overlay className={styles.overlay()} />
      <Primitive.Content
        aria-describedby={undefined}
        // The field, not the panel: a palette opens to be typed into, and
        // Radix would otherwise focus the first option-bearing element.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          field.current?.focus()
        }}
        className={styles.panel()}
      >
        <VisuallyHidden.Root>
          <Primitive.Title>{title}</Primitive.Title>
        </VisuallyHidden.Root>

        <div aria-busy={busy} className={styles.search()}>
          <SearchIcon />
          <input
            ref={field}
            type="text"
            role="combobox"
            autoComplete="off"
            spellCheck={false}
            aria-label={inputLabel}
            aria-expanded={optionIds.length > 0}
            aria-controls={listId}
            aria-busy={busy}
            {...(activeId === undefined ? {} : { 'aria-activedescendant': activeId })}
            {...(description === undefined ? {} : { 'aria-describedby': descriptionId })}
            {...(placeholder === undefined ? {} : { placeholder })}
            value={value}
            onChange={(event) => {
              setWanted(0)
              onValueChange(event.target.value)
            }}
            onKeyDown={onKeyDown}
            className={styles.field()}
          />
          {busy ? <Spinner /> : undefined}
        </div>

        {description === undefined ? undefined : (
          <VisuallyHidden.Root id={descriptionId}>{description}</VisuallyHidden.Root>
        )}

        {optionIds.length === 0 ? undefined : (
          <div id={listId} role="listbox" aria-label={title} className={styles.list()}>
            {rows.map((group) => (
              <div
                key={group.id}
                role="group"
                aria-labelledby={`${ids}-group-${group.id}`}
                className={styles.group()}
              >
                <p id={`${ids}-group-${group.id}`} className={styles.groupLabel()}>
                  {group.label}
                </p>
                {group.options.map((option) => (
                  <button
                    key={option.id}
                    id={`${ids}-option-${option.position}`}
                    type="button"
                    role="option"
                    // Not a tab stop: the field keeps focus and moves
                    // `aria-activedescendant` instead, so Tab remains a way
                    // out rather than a walk through every result.
                    tabIndex={-1}
                    aria-selected={option.position === active}
                    // The name is the label's own text, not the row's: pointing
                    // at the element keeps the accessible name and the visible
                    // words identical (WCAG 2.5.3), which an `aria-label`
                    // restating the title would only promise.
                    aria-labelledby={`${ids}-label-${option.position}`}
                    {...(option.detail === undefined
                      ? {}
                      : { 'aria-describedby': `${ids}-detail-${option.position}` })}
                    onClick={() => {
                      onSelect(option.id)
                    }}
                    className={styles.option()}
                  >
                    <span id={`${ids}-label-${option.position}`} className={styles.optionLabel()}>
                      {option.label}
                    </span>
                    {option.detail === undefined ? undefined : (
                      <span
                        id={`${ids}-detail-${option.position}`}
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
        )}

        {notice === undefined ? undefined : <div className={styles.notice()}>{notice}</div>}

        {/* Polite, and outside the listbox so it is never an option: the list
            is what changed, and this is the sentence that says so. */}
        <VisuallyHidden.Root role="status" aria-live="polite">
          {status ?? ''}
        </VisuallyHidden.Root>

        {footer === undefined ? undefined : <div className={styles.footer()}>{footer}</div>}
      </Primitive.Content>
    </Primitive.Portal>
  )
}
