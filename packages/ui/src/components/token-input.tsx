import {
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

import { tv } from '../lib/class-names.ts'
import { CloseIcon } from './icons.tsx'
import { inputStyles } from './input.tsx'
import { GroupedListbox, useListboxCursor, type ListboxGroup } from './listbox.tsx'
import { Spinner } from './spinner.tsx'

/**
 * A field that holds several values as tokens: a document's tags, its owners.
 *
 * The text box is an ARIA 1.2 editable combobox over the same grouped listbox
 * and cursor as `Combobox` and the command palette (`listbox.tsx`), so the
 * three cannot come to behave differently: arrows walk the suggestions while
 * focus stays in the field, Enter takes the active one, Escape closes them.
 * What it adds is what a token field needs and a single-value field does not:
 *
 * - **Enter or a comma** with no suggestion active adds what was typed, when
 *   the caller accepts text (`onEnterText`); a field that only takes known
 *   values (people) leaves it in the box.
 * - **A pasted list** — commas or new lines — becomes several tokens at once.
 * - **Backspace** in an empty field removes the last token; each token also
 *   has its own remove button, and focus returns to the field either way.
 *
 * The suggestions are listed under the field rather than floating over the
 * page, because this field lives in a popover that is already floating.
 */

export const tokenInputStyles = tv({
  slots: {
    root: 'flex flex-col gap-1.5',
    box: [
      'flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface px-1.5',
      'py-1 focus-within:border-border-strong focus-within:outline-2',
      'focus-within:outline-offset-1 focus-within:outline-focus-ring',
      'has-disabled:opacity-60',
    ],
    tokens: 'contents list-none',
    token: [
      'inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-full border border-border',
      'bg-surface-raised ps-2 pe-0.5 text-xs text-foreground',
    ],
    tokenLabel: 'truncate',
    remove: [
      'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted',
      'hover:bg-surface hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
      'pointer-coarse:size-7',
    ],
    removeIcon: 'size-3',
    input: [
      'h-7 min-w-24 flex-1 bg-transparent px-1 text-sm text-foreground outline-hidden',
      'placeholder:text-muted disabled:cursor-not-allowed',
    ],
    busy: 'pe-1 text-muted',
    popup: 'flex flex-col',
    list: 'max-h-56 p-0.5',
    notice: 'px-2 py-2 text-xs text-muted',
  },
})

export interface Token {
  /** What `onRemove` is given; unique among the tokens. */
  readonly id: string
  readonly label: string
  /** A mark before the label: a person's avatar. */
  readonly leading?: ReactNode
}

export interface TokenInputProps {
  /** The visible label. Never optional, as on `Input`. */
  readonly label: string
  readonly tokens: readonly Token[]
  /** What is being typed, which is the caller's query. */
  readonly query: string
  readonly onQueryChange: (query: string) => void
  readonly groups: readonly ListboxGroup[]
  /** A suggestion was chosen. */
  readonly onChoose: (optionId: string) => void
  /** Typed or pasted text to add as it stands; absent, only suggestions are taken. */
  readonly onEnterText?: ((texts: readonly string[]) => void) | undefined
  readonly onRemove: (tokenId: string) => void
  readonly placeholder?: string | undefined
  readonly description?: string | undefined
  readonly busy?: boolean | undefined
  /** Shown in place of suggestions — "Searching…", "Nobody matches". */
  readonly notice?: ReactNode | undefined
  readonly disabled?: boolean | undefined
  /** Takes focus when it appears: it is the first thing in the popover that opens it. */
  readonly focusOnMount?: boolean | undefined
  readonly className?: string | undefined
}

/** A pasted or typed run of values: split on commas and new lines, trimmed, empties dropped. */
function splitValues(text: string): readonly string[] {
  return text
    .split(/[,\n\r]+/u)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

export function TokenInput({
  label,
  tokens,
  query,
  onQueryChange,
  groups,
  onChoose,
  onEnterText,
  onRemove,
  placeholder,
  description,
  busy = false,
  notice,
  disabled = false,
  focusOnMount = false,
  className,
}: TokenInputProps) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const cursor = useListboxCursor(groups)
  const [expanded, setExpanded] = useState(false)
  const styles = tokenInputStyles()
  const field = inputStyles()

  const open = expanded && (cursor.size > 0 || notice !== undefined)
  const descriptionId = `${id}-description`

  function enterText(texts: readonly string[]): void {
    if (onEnterText === undefined || texts.length === 0) return
    onEnterText(texts)
    cursor.reset()
  }

  function remove(tokenId: string): void {
    onRemove(tokenId)
    input.current?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    switch (event.key) {
      case 'ArrowDown':
        if (open) cursor.move(1)
        else setExpanded(true)
        break
      case 'ArrowUp':
        if (!open) return
        cursor.move(-1)
        break
      case 'Enter': {
        const chosen = open ? cursor.activeOption() : undefined
        if (chosen !== undefined) {
          onChoose(chosen)
          cursor.reset()
        } else {
          enterText(splitValues(query))
        }
        break
      }
      case ',':
        if (onEnterText === undefined) return
        enterText(splitValues(query))
        break
      case 'Backspace': {
        const last = tokens.at(-1)
        if (query !== '' || last === undefined) return
        onRemove(last.id)
        break
      }
      case 'Escape':
        // A second Escape is the popover's: it closes the whole editor.
        if (!open) return
        setExpanded(false)
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>): void {
    const values = splitValues(event.clipboardData.getData('text'))
    if (onEnterText === undefined || values.length < 2) return
    event.preventDefault()
    enterText(values)
  }

  return (
    <div className={styles.root({ className })}>
      <label htmlFor={id} className={field.label()}>
        {label}
      </label>
      <div className={styles.box()}>
        <ul aria-label={label} className={styles.tokens()}>
          {tokens.map((token) => (
            <li key={token.id} className={styles.token()}>
              {token.leading}
              <span className={styles.tokenLabel()}>{token.label}</span>
              {disabled ? undefined : (
                <button
                  type="button"
                  aria-label={`Remove ${token.label}`}
                  className={styles.remove()}
                  onClick={() => {
                    remove(token.id)
                  }}
                >
                  <CloseIcon className={styles.removeIcon()} />
                </button>
              )}
            </li>
          ))}
        </ul>
        <input
          ref={input}
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          // The field is the first thing in the popover it opens with.
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={focusOnMount}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={cursor.listId}
          aria-busy={busy}
          {...(open && cursor.activeId !== undefined
            ? { 'aria-activedescendant': cursor.activeId }
            : {})}
          {...(description === undefined ? {} : { 'aria-describedby': descriptionId })}
          {...(placeholder === undefined ? {} : { placeholder })}
          disabled={disabled}
          value={query}
          onChange={(event) => {
            cursor.reset()
            setExpanded(true)
            onQueryChange(event.target.value)
          }}
          onFocus={() => {
            setExpanded(true)
          }}
          onBlur={() => {
            setExpanded(false)
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className={styles.input()}
        />
        {busy ? (
          <span className={styles.busy()}>
            <Spinner />
          </span>
        ) : undefined}
      </div>
      {description === undefined ? undefined : (
        <p id={descriptionId} className={field.description()}>
          {description}
        </p>
      )}
      {open ? (
        <div className={styles.popup()}>
          {cursor.size === 0 ? undefined : (
            <GroupedListbox
              cursor={cursor}
              label={label}
              onSelect={(optionId) => {
                onChoose(optionId)
                cursor.reset()
              }}
              className={styles.list()}
            />
          )}
          {notice === undefined ? undefined : <p className={styles.notice()}>{notice}</p>}
        </div>
      ) : undefined}
    </div>
  )
}
