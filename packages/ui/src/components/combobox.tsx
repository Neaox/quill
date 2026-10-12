import {
  useId,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react'

import type { VariantProps } from 'tailwind-variants'

import { tv } from '../lib/class-names.ts'
import { inputStyles } from './input.tsx'
import { GroupedListbox, useListboxCursor, type ListboxGroup } from './listbox.tsx'
import { Spinner } from './spinner.tsx'

/**
 * The popup hangs under the field, inside the form rather than in a portal:
 * it belongs to the field, scrolls with it, and is the next thing in reading
 * order after it.
 *
 * The `inline` variant is a field that sits in a toolbar and shows a value — a
 * code block's language — rather than a form row: its label is for assistive
 * technology only, and its popup is raised into the top layer (`popover`) and
 * anchored to the field with CSS anchor positioning, because a toolbar's card
 * clips what overflows it. Still the next thing in reading order: the top
 * layer moves how the popup is painted, not where it is in the document.
 */
export const comboboxStyles = tv({
  slots: {
    field: 'relative',
    label: '',
    control: '',
    busy: 'pointer-events-none absolute inset-y-0 end-2.5 flex items-center text-muted',
    popup: [
      'absolute inset-x-0 top-full z-30 mt-1 flex flex-col rounded-md border border-border',
      'bg-surface-raised text-foreground shadow-raised',
    ],
    list: 'max-h-80 p-1',
    notice: 'px-3 py-2.5 text-xs text-muted',
  },
  variants: {
    variant: {
      field: {},
      inline: {
        label: 'sr-only',
        control: [
          // At least 24px to aim at (WCAG 2.5.8), and the 44px touch size on a coarse pointer.
          'h-6 w-32 border-transparent bg-transparent px-1.5 text-2xs tracking-caps text-muted',
          'pointer-coarse:h-11 pointer-coarse:w-36',
          'uppercase placeholder:text-muted hover:border-border hover:text-foreground',
          'focus:border-border focus:bg-surface-raised focus:text-foreground focus:normal-case',
          'focus:tracking-normal',
        ],
        popup: [
          'fixed inset-auto m-0 mt-1 w-64 max-w-[calc(100vw-2rem)] p-0',
          '[top:anchor(bottom)] [right:anchor(right)] [position-try-fallbacks:flip-block,flip-inline]',
        ],
        list: 'max-h-72',
      },
    },
  },
  defaultVariants: { variant: 'field' },
})

/** Where the field sits: a form row, or a toolbar that shows a value. */
export type ComboboxVariant = NonNullable<VariantProps<typeof comboboxStyles>['variant']>

export interface ComboboxProps {
  /** The visible label. Never optional, as on `Input`. */
  readonly label: string
  readonly description?: string | undefined
  /** Validation message. Its presence is what marks the field invalid. */
  readonly error?: string | undefined
  /** Controlled, because what was typed is the caller's query. */
  readonly value: string
  readonly onValueChange: (value: string) => void
  readonly placeholder?: string | undefined
  readonly groups: readonly ListboxGroup[]
  readonly onSelect: (optionId: string) => void
  /** An answer is on the way: the field reads busy and shows a spinner. */
  readonly busy?: boolean | undefined
  /**
   * Shown in the popup in place of options — "Searching…", "Nothing matches"
   * — so an open popup is never an empty box. Undefined means there is nothing
   * to say, and with no options the popup stays closed.
   */
  readonly notice?: ReactNode | undefined
  /**
   * The settled answer in a sentence, announced politely when it changes:
   * "3 results". Nothing while an answer is still on the way.
   */
  readonly status?: string | undefined
  /** Escape with the popup already closed: the caller's cue to give up, such as closing a composer. */
  readonly onDismiss?: (() => void) | undefined
  /** The text field, for a caller that moves focus to it — a composer that has just opened. */
  readonly inputRef?: Ref<HTMLInputElement> | undefined
  readonly className?: string | undefined
  readonly variant?: ComboboxVariant | undefined
  /**
   * When the popup opens. `on-focus`, the default, suits a field somebody
   * comes to in order to search. `on-request` suits a field that shows a value
   * and is passed through on the way elsewhere: focus selects the value, so
   * typing replaces it, and the popup opens on typing, on ArrowDown (Alt with
   * it included) or on Enter.
   */
  readonly opens?: 'on-focus' | 'on-request' | undefined
}

/**
 * Raises an inline popup into the top layer as it appears, where the browser
 * has popovers; elsewhere it stays where it is, positioned by its classes.
 */
function raise(popup: HTMLDivElement | null): void {
  if (popup !== null && 'showPopover' in popup) popup.showPopover()
}

/**
 * A labelled text field that suggests options as somebody types: the ARIA
 * 1.2 editable combobox with list autocomplete (`role="combobox"` on the
 * input, a `listbox` popup it controls, `aria-activedescendant` for the
 * option the arrows have reached).
 *
 * The keys: ArrowDown opens the popup and walks down, ArrowUp walks up, Enter
 * chooses the active option, Escape closes the popup — and, pressed again,
 * tells the caller through `onDismiss`. Typing opens it and starts again from
 * the first option. Leaving the field closes it. Home and End stay the
 * caret's, as in any text box.
 *
 * The list and its cursor are the command palette's (`listbox.tsx`), so the
 * two comboboxes in the product cannot come to behave differently.
 */
export function Combobox({
  label,
  description,
  error,
  value,
  onValueChange,
  placeholder,
  groups,
  onSelect,
  busy = false,
  notice,
  status,
  onDismiss,
  inputRef,
  className,
  variant = 'field',
  opens = 'on-focus',
}: ComboboxProps) {
  const id = useId()
  const cursor = useListboxCursor(groups)
  const [expanded, setExpanded] = useState(false)
  const field = inputStyles()
  const styles = comboboxStyles({ variant })
  const inline = variant === 'inline'
  // A dashed ident per field, so two popups never find each other's anchor.
  const anchor = `--combobox-${id.replaceAll(/[^\w-]/gu, '')}`

  const hasContent = cursor.size > 0 || notice !== undefined
  const open = expanded && hasContent
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  const describedBy = [
    description === undefined ? undefined : descriptionId,
    error === undefined ? undefined : errorId,
  ]
    .filter((part) => part !== undefined)
    .join(' ')

  function choose(optionId: string): void {
    setExpanded(false)
    onSelect(optionId)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      if (open) cursor.move(1)
      else setExpanded(true)
    } else if (event.key === 'ArrowUp') {
      if (open) cursor.move(-1)
    } else if (event.key === 'Enter') {
      if (!open && opens === 'on-request' && cursor.size > 0) {
        setExpanded(true)
        event.preventDefault()
        return
      }
      const chosen = open ? cursor.activeOption() : undefined
      if (chosen === undefined) return
      choose(chosen)
    } else if (event.key === 'Escape') {
      if (open) setExpanded(false)
      else if (onDismiss === undefined) return
      else onDismiss()
    } else {
      return
    }
    event.preventDefault()
  }

  return (
    <div className={field.root({ className })}>
      <label htmlFor={id} className={field.label({ className: styles.label() })}>
        {label}
      </label>
      <div className={styles.field()}>
        <input
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={cursor.listId}
          aria-invalid={error !== undefined}
          aria-busy={busy}
          {...(open && cursor.activeId !== undefined
            ? { 'aria-activedescendant': cursor.activeId }
            : {})}
          {...(describedBy === '' ? {} : { 'aria-describedby': describedBy })}
          {...(placeholder === undefined ? {} : { placeholder })}
          {...(inputRef === undefined ? {} : { ref: inputRef })}
          value={value}
          onChange={(event) => {
            cursor.reset()
            setExpanded(true)
            onValueChange(event.target.value)
          }}
          onFocus={(event: FocusEvent<HTMLInputElement>) => {
            if (opens === 'on-focus') setExpanded(true)
            else event.currentTarget.select()
          }}
          onBlur={() => {
            setExpanded(false)
          }}
          onKeyDown={onKeyDown}
          className={field.control({ className: styles.control() })}
          {...(inline ? { style: { anchorName: anchor } } : {})}
        />
        {busy ? (
          <span className={styles.busy()}>
            <Spinner />
          </span>
        ) : undefined}
        {open ? (
          <div
            className={styles.popup()}
            {...(inline
              ? { popover: 'manual' as const, ref: raise, style: { positionAnchor: anchor } }
              : {})}
          >
            {cursor.size === 0 ? undefined : (
              <GroupedListbox
                cursor={cursor}
                label={label}
                onSelect={choose}
                className={styles.list()}
              />
            )}
            {notice === undefined ? undefined : <div className={styles.notice()}>{notice}</div>}
          </div>
        ) : undefined}
      </div>
      {description === undefined ? undefined : (
        <p id={descriptionId} className={field.description()}>
          {description}
        </p>
      )}
      {error === undefined ? undefined : (
        <p id={errorId} role="alert" className={field.error()}>
          {error}
        </p>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {status ?? ''}
      </span>
    </div>
  )
}
