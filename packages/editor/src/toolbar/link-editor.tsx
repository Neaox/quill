import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { tv } from 'tailwind-variants'

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
    form: 'flex items-center gap-1',
    field: 'flex flex-col',
    input: [
      'h-8 w-64 rounded-sm border border-border-strong bg-surface px-2 text-sm text-foreground',
      'placeholder:text-muted focus-visible:outline-2 focus-visible:outline-focus-ring',
      'aria-invalid:border-danger',
    ],
    error: 'px-1 pt-0.5 text-xs text-danger',
  },
})
const styles = linkEditor()
const buttons = toolbarStyles()

const REFUSAL = 'Use a web address, an email address, or a path in this site.'

export interface LinkEditorProps {
  /** The address the selection already links to, if it does. */
  readonly href: string | null
  onApply(href: string): void
  onRemove(): void
  onCancel(): void
}

export function LinkEditor({ href, onApply, onRemove, onCancel }: LinkEditorProps) {
  const [value, setValue] = useState(href ?? '')
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
    const address = normaliseHref(value)
    if (address === null) {
      setRefused(true)
      return
    }
    onApply(address)
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
