import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '@quill/ui'

import { useRenameDocument } from '../../lib/api/index.ts'
import { FormError } from '../../lib/forms/form-error.tsx'

export interface RenameDocumentControlProps {
  readonly documentId: string
  readonly title: string
}

/**
 * The inline rename affordance in the document header.
 *
 * Not-editing is a single labelled button — a pencil, named after the
 * document it renames — so a click on it, or `F2`/`Enter` while it has focus
 * (a button already answers `Enter` and `Space` natively), starts editing.
 * It does not repeat the title: the header's own readout is already saying
 * it, a step away, and a bar that says the same thing twice is a bar that
 * has to truncate both. Once
 * editing, `Enter` (submitting the form) and blur both save; `Escape` reverts
 * without saving. The field's own `Save` button carries the pending state
 * (`docs/design/feedback.md`) regardless of which of those three triggered
 * it, so a screen reader hears `aria-busy` either way.
 */
export function RenameDocumentControl({ documentId, title }: RenameDocumentControlProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  const cancelledRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const rename = useRenameDocument()

  // Moves focus into the field once it exists: an external system (the
  // browser's focus manager), which is what an effect is for (AGENTS.md rule
  // 6) — `autoFocus` is rejected by `jsx-a11y/no-autofocus`, and this fires
  // only on the `editing` transition rather than on every keystroke.
  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function startEditing() {
    cancelledRef.current = false
    setValue(title)
    setEditing(true)
  }

  function cancel() {
    cancelledRef.current = true
    setValue(title)
    setEditing(false)
  }

  function save() {
    if (rename.isPending) return
    const next = value.trim()
    if (next === '' || next === title) {
      setEditing(false)
      setValue(title)
      return
    }
    rename.mutate(
      { documentId, title: next },
      {
        onSuccess: () => {
          setEditing(false)
        },
      },
    )
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={startEditing}
        onKeyDown={(event) => {
          if (event.key === 'F2') {
            event.preventDefault()
            startEditing()
          }
        }}
        aria-label={`Rename "${title}"`}
        title={`Rename "${title}"`}
        className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <span aria-hidden="true">✎</span>
      </button>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
      className="relative flex items-center gap-1.5"
    >
      <label htmlFor={inputId} className="sr-only">
        Document title
      </label>
      <input
        id={inputId}
        ref={inputRef}
        value={value}
        disabled={rename.isPending}
        aria-invalid={rename.isError}
        onChange={(event) => {
          setValue(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            cancel()
          }
        }}
        onBlur={() => {
          if (cancelledRef.current) {
            cancelledRef.current = false
            return
          }
          save()
        }}
        className="h-7 w-48 min-w-0 rounded-md border border-border bg-surface-raised px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring aria-invalid:border-danger"
      />
      <Button type="submit" size="sm" variant="ghost" loading={rename.isPending}>
        Save
      </Button>
      {rename.isError ? (
        <div className="absolute top-full left-0 z-10 mt-1 rounded-md border border-border bg-surface-raised px-2 py-1 whitespace-nowrap shadow-raised">
          <FormError error={rename.error} />
        </div>
      ) : undefined}
    </form>
  )
}
