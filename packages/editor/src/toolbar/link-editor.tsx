import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { tv } from 'tailwind-variants'

import { LINK_DISPLAY_CHOICES, NO_LINE_OF_ITS_OWN } from '../actions/link-display-actions.ts'
import type { LinkDisplayChoice } from '../actions/link-display-actions.ts'
import { normaliseHref } from '../format/href.ts'
import { toolbarStyles } from './toolbar-controls.tsx'

/**
 * The box an address is typed into.
 *
 * It replaces the toolbar's buttons rather than opening beside them, so there is
 * one thing to look at and one place focus is. An address is checked before it is
 * applied (`normaliseHref`): one a document may not carry is refused *here*, with
 * the reason beside the box, instead of being accepted and dropped when the
 * document is published. The refusal is `aria-invalid` and `aria-describedby`,
 * so it is announced as well as shown.
 */

const linkEditor = tv({
  slots: {
    form: 'flex flex-wrap items-center gap-1',
    field: 'flex min-w-0 max-w-full flex-col',
    input: [
      'h-8 w-64 max-w-full rounded-sm border border-border-strong bg-surface px-2 text-sm text-foreground',
      'placeholder:text-muted focus-visible:outline-2 focus-visible:outline-focus-ring',
      'aria-invalid:border-danger',
    ],
    error: 'px-1 pt-0.5 text-xs text-danger',
    // The choice of display: native radios, so the group is one tab stop and the arrows move
    // inside it. The radio carries the state, and the label follows it.
    choices: 'flex min-w-0 items-center gap-0.5 rounded-sm border-0 bg-surface p-0.5',
    choice: [
      'relative inline-flex h-7 min-w-8 cursor-pointer items-center justify-center rounded-sm px-2 text-sm',
      'text-foreground transition-colors ease-standard hover:bg-surface-raised',
      'has-checked:bg-accent-subtle has-checked:text-accent',
      'has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-focus-ring',
      'has-disabled:cursor-not-allowed has-disabled:opacity-40 has-disabled:hover:bg-transparent',
    ],
    radio: 'absolute inset-0 m-0 cursor-[inherit] appearance-none opacity-0',
    legend: 'sr-only',
    hint: 'sr-only',
  },
})
const styles = linkEditor()
const buttons = toolbarStyles()

const REFUSAL = 'Use a web address, an email address, or a path in this site.'

export interface LinkEditorProps {
  /** The address the selection already links to, if it does. */
  readonly href: string | null
  /**
   * The display the link has now, or `url` for words that are not a link yet. Absent, the box
   * offers no choice of display (an editor with nothing to show a link as).
   */
  readonly display?: LinkDisplayChoice | undefined
  /** Whether the selection is somewhere a card or a compact line can go. */
  readonly blockFits?: boolean | undefined
  /**
   * The address cannot be changed here: the link is written as a directive, whose address is
   * the words it was made from. The box then only changes how it is shown.
   */
  readonly addressLocked?: boolean | undefined
  onApply(href: string, display: LinkDisplayChoice): void
  onRemove(): void
  onCancel(): void
}

export function LinkEditor({
  href,
  display,
  blockFits = true,
  addressLocked = false,
  onApply,
  onRemove,
  onCancel,
}: LinkEditorProps) {
  const [value, setValue] = useState(href ?? '')
  const [shownAs, setShownAs] = useState<LinkDisplayChoice>(display ?? 'url')
  const choicesId = useId()
  const [refused, setRefused] = useState(false)
  const input = useRef<HTMLInputElement | null>(null)
  const errorId = useId()

  // Focus belongs in the box the moment it opens: the author asked to type here.
  // This has to wait for an effect rather than a ref callback: the toolbar that
  // holds the box is told focus moved into it, and it can only recognise the box
  // once the toolbar's own ref is attached, which is after its children's are.
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  /** Escape gives up, from the box and from any of its buttons. */
  function cancelOnEscape(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onCancel()
  }

  function submit(event: FormEvent): void {
    event.preventDefault()
    const address = addressLocked && href !== null ? href : normaliseHref(value)
    if (address === null) {
      setRefused(true)
      return
    }
    onApply(address, shownAs)
  }

  return (
    <form className={styles.form()} onSubmit={submit}>
      <div className={styles.field()}>
        <input
          ref={input}
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-label="Link address"
          aria-invalid={refused || undefined}
          aria-describedby={refused ? errorId : undefined}
          placeholder="Paste or type an address"
          readOnly={addressLocked}
          className={styles.input()}
          onKeyDown={cancelOnEscape}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setRefused(false)
          }}
        />
        {refused ? (
          <p id={errorId} role="alert" className={styles.error()}>
            {REFUSAL}
          </p>
        ) : null}
      </div>
      {display === undefined ? null : (
        <fieldset
          role="radiogroup"
          aria-label="Show link as"
          className={styles.choices()}
          onKeyDown={cancelOnEscape}
        >
          {LINK_DISPLAY_CHOICES.map(({ display: choice, label, description }) => {
            const unavailable = !blockFits && (choice === 'card' || choice === 'compact')
            return (
              <label key={choice} className={styles.choice()} title={description}>
                <input
                  type="radio"
                  name={choicesId}
                  className={styles.radio()}
                  aria-label={label}
                  checked={shownAs === choice}
                  disabled={unavailable}
                  aria-describedby={unavailable ? `${choicesId}-why` : undefined}
                  onChange={() => {
                    setShownAs(choice)
                  }}
                />
                {label}
              </label>
            )
          })}
          {blockFits ? null : (
            <span id={`${choicesId}-why`} className={styles.hint()}>
              {NO_LINE_OF_ITS_OWN}
            </span>
          )}
        </fieldset>
      )}
      <button type="submit" className={buttons.button()} onKeyDown={cancelOnEscape}>
        Apply
      </button>
      {href === null ? null : (
        <button
          type="button"
          className={buttons.button()}
          onClick={onRemove}
          onKeyDown={cancelOnEscape}
        >
          Remove
        </button>
      )}
      <button
        type="button"
        className={buttons.button()}
        onClick={onCancel}
        onKeyDown={cancelOnEscape}
      >
        Cancel
      </button>
    </form>
  )
}
