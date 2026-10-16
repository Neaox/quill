import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { tv } from 'tailwind-variants'

import type { EditorLinkPreview } from '../blocks/link-preview-context.tsx'
import { toolbarStyles } from './toolbar-controls.tsx'

/**
 * Preview details: the words on a card that the author may replace (ADR-042).
 *
 * The fetched title and description are shown as the fields' placeholders, so
 * the author sees what is there before choosing to say something different, and
 * an empty field means "use the page's". A description can also be hidden
 * altogether, which is a choice of its own and not an empty field. "Reset to
 * fetched" gives both back at once. This also repairs a page whose tags are wrong
 * or missing, and gives a stable result where the host blocks us.
 *
 * Like the link box it replaces the toolbar's buttons, so there is one place to
 * look and one place focus is, and Escape gives up from anywhere in it.
 */

const details = tv({
  slots: {
    form: 'flex flex-wrap items-center gap-1',
    input: [
      'h-8 w-44 rounded-sm border border-border-strong bg-surface px-2 text-sm text-foreground',
      'placeholder:text-muted focus-visible:outline-2 focus-visible:outline-focus-ring',
      'disabled:opacity-50',
    ],
    check: 'flex items-center gap-1 px-1 text-xs text-body',
  },
})
const styles = details()
const buttons = toolbarStyles()

export interface CardDetails {
  /** The author's own title, or null to use the page's. */
  readonly title: string | null
  /** The author's own description; the empty string hides it; null uses the page's. */
  readonly description: string | null
}

export interface LinkDetailsEditorProps {
  readonly current: CardDetails
  /** What the page itself says, shown where the author's own words would go. */
  readonly fetched: EditorLinkPreview | null
  onApply(details: CardDetails): void
  onReset(): void
  onCancel(): void
}

export function LinkDetailsEditor({
  current,
  fetched,
  onApply,
  onReset,
  onCancel,
}: LinkDetailsEditorProps) {
  const [title, setTitle] = useState(current.title ?? '')
  const [description, setDescription] = useState(current.description ?? '')
  const [hidden, setHidden] = useState(current.description === '')
  const first = useRef<HTMLInputElement | null>(null)
  const hiddenId = useId()

  // Focus belongs in the box the moment it opens: the author asked to type here.
  useEffect(() => {
    first.current?.focus()
    first.current?.select()
  }, [])

  function cancelOnEscape(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onCancel()
  }

  function submit(event: FormEvent): void {
    event.preventDefault()
    const own = description.trim()
    onApply({
      title: title.trim() === '' ? null : title.trim(),
      description: hidden ? '' : own === '' ? null : own,
    })
  }

  return (
    <form className={styles.form()} onSubmit={submit}>
      <input
        ref={first}
        type="text"
        autoComplete="off"
        aria-label="Card title"
        placeholder={fetched?.title ?? 'Title'}
        className={styles.input()}
        onKeyDown={cancelOnEscape}
        value={title}
        onChange={(event) => {
          setTitle(event.target.value)
        }}
      />
      <input
        type="text"
        autoComplete="off"
        aria-label="Card description"
        placeholder={fetched?.description ?? 'Description'}
        disabled={hidden}
        className={styles.input()}
        onKeyDown={cancelOnEscape}
        value={description}
        onChange={(event) => {
          setDescription(event.target.value)
        }}
      />
      <label htmlFor={hiddenId} className={styles.check()}>
        <input
          id={hiddenId}
          type="checkbox"
          checked={hidden}
          onKeyDown={cancelOnEscape}
          onChange={(event) => {
            setHidden(event.target.checked)
          }}
        />
        No description
      </label>
      <button type="submit" className={buttons.button()} onKeyDown={cancelOnEscape}>
        Apply
      </button>
      <button
        type="button"
        className={buttons.button()}
        onClick={onReset}
        onKeyDown={cancelOnEscape}
      >
        Reset to fetched
      </button>
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
