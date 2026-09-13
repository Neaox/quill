import { useEffect, useState, type ReactNode } from 'react'

/**
 * The part of the toast vocabulary that owes nothing to the toast library:
 * the tones, the word each one speaks, and the assertive live region a
 * `danger` toast is announced through.
 *
 * It lives apart from `toaster.tsx` so that `toast.ts` can reach it without
 * reaching `sonner` — which is what lets the toast host be loaded on demand
 * rather than by every reader who opens a document (review 2026-09-13, H1).
 */
export type ToastTone = 'neutral' | 'success' | 'info' | 'warning' | 'danger'

/**
 * The word each tone carries, for the same reason `Callout` carries one: the
 * icon and the leading rule are colour, and colour is never the only signal
 * (`docs/architecture/styling.md`). `neutral` has no word of its own — a
 * plain message is not a claim about anything, so there is nothing to name.
 */
export const DANGER_TONE_LABEL = 'Danger'

export const TOAST_TONE_LABEL: Partial<Record<ToastTone, string>> = {
  success: 'Success',
  info: 'Note',
  warning: 'Warning',
  danger: DANGER_TONE_LABEL,
}

/**
 * Wraps a caller's title in the tone word (visually hidden, read first) and a
 * `data-tone` attribute a specimen or a test can key off. Used for every
 * `toast.*` call, including each phase of `toast.promise`, so the announced
 * text always carries the same tone the border and icon do.
 */
export function toneTitle(tone: ToastTone, title: ReactNode): ReactNode {
  const label = TOAST_TONE_LABEL[tone]
  return (
    <span data-tone={tone}>
      {label === undefined ? undefined : <span className="sr-only">{label}: </span>}
      {title}
    </span>
  )
}

/**
 * A minimal observer — `subscribe` returning the unsubscribe (rule 19) —
 * carrying `danger` toast text to an assertive live region. The toast
 * library's own region is a single polite one shared by every toast
 * (`docs/design/feedback.md`: "a `danger` toast is assertive"), so making one
 * tone louder means a second, purpose-built region. `toast.ts` publishes into
 * this directly, before the toast host has even been asked for, so urgency is
 * never waiting on a chunk.
 */
type AssertiveListener = (message: string) => void
const assertiveListeners = new Set<AssertiveListener>()

/** Announces `message` assertively, alongside — not instead of — the polite region every tone already gets. */
export function announceAssertively(message: string): void {
  for (const listener of assertiveListeners) listener(message)
}

function subscribeAssertive(listener: AssertiveListener): () => void {
  assertiveListeners.add(listener)
  return () => {
    assertiveListeners.delete(listener)
  }
}

/**
 * Visually hidden: the toast library's own polite region already renders every
 * toast's text where a screen reader can reach it, so this exists only to add
 * urgency for `danger`, never to duplicate the visible toast itself.
 */
export function AssertiveAnnouncer(): ReactNode {
  const [message, setMessage] = useState('')
  // Synchronises with the module-level listener set above, which `toast.ts`
  // publishes into from outside React entirely.
  useEffect(() => subscribeAssertive(setMessage), [])

  return (
    <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
      {message}
    </div>
  )
}
