import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Dialog as Primitive, VisuallyHidden } from 'radix-ui'

import { tv } from '../lib/class-names.ts'
import { SearchIcon } from './icons.tsx'
import {
  GroupedListbox,
  useListboxCursor,
  type ListboxGroup,
  type ListboxOption,
} from './listbox.tsx'
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
    list: 'min-h-0 grow p-2',
    notice: 'min-h-0 grow overflow-y-auto px-4 py-6 text-sm text-muted',
    footer: 'flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-2',
  },
})

/** An option in the palette: `ListboxOption`, named for where it is used. */
export type CommandPaletteOption = ListboxOption

export type CommandPaletteGroup = ListboxGroup

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

/**
 * The command palette: a field over a grouped list, in a modal dialog.
 *
 * **Combobox and listbox, not a list of buttons** (`listbox.tsx`, which the
 * `Combobox` field shares). The field keeps focus while the arrows move
 * `aria-activedescendant` through the options, so somebody types a few
 * letters and presses Enter without ever leaving it, and Tab stays a way out
 * of the panel rather than a walk through fifty results.
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
  const cursor = useListboxCursor(groups)
  const descriptionId = `${ids}-description`
  const styles = commandPaletteStyles()

  function choose(): void {
    const chosen = cursor.activeOption()
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
    if (event.key === 'ArrowDown') cursor.move(1)
    else if (event.key === 'ArrowUp') cursor.move(-1)
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
            aria-expanded={cursor.size > 0}
            aria-controls={cursor.listId}
            aria-busy={busy}
            {...(cursor.activeId === undefined ? {} : { 'aria-activedescendant': cursor.activeId })}
            {...(description === undefined ? {} : { 'aria-describedby': descriptionId })}
            {...(placeholder === undefined ? {} : { placeholder })}
            value={value}
            onChange={(event) => {
              cursor.reset()
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

        {cursor.size === 0 ? undefined : (
          <GroupedListbox
            cursor={cursor}
            label={title}
            onSelect={onSelect}
            className={styles.list()}
          />
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

export { positionOptions } from './listbox.tsx'
