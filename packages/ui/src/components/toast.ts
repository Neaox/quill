import type { ReactNode } from 'react'

import { announceAssertively, DANGER_TONE_LABEL, type ToastTone } from './toast-tone.tsx'

export type { ToastTone }

/**
 * The typed API `docs/design/feedback.md` calls "the `toast` module in
 * `packages/ui`" — the second of the product's three feedback channels,
 * alongside inline status and the blocking `Dialog`.
 *
 * `toast.promise` is that document's rule, not a general-purpose spinner:
 * background work that concerns the page the reader is on — a document's
 * background sync, publish, restore, taking over a lock, an export started
 * here — and only that. Work that does not concern the current page is a
 * badge where it lives, never a toast.
 *
 * Two more of that document's rules are structural here, not just written
 * down: the resolved state of a promise toast may carry exactly one action
 * (`ToastPromiseOutcome` has no `cancel` field at all), and a toast that
 * carries an action stays until dismissed rather than timing out under it.
 * "A retry replaces the toast; it does not stack a second one" is what the
 * optional `id` on `toast.promise` is for — pass back the id an earlier call
 * returned and the same toast updates in place.
 *
 * **This module holds no toast library.** It states what was asked for and
 * hands it to a `ToastSink`, which `sonner-toaster.tsx` installs when the
 * toast host mounts — a chunk the application fetches after it has painted,
 * so a reader who opens a document never downloads a stack they may never
 * see (review 2026-09-13, H1). A call made before the host is there is held
 * and replayed, so nothing is lost in the window between the two; the
 * assertive announcement a `danger` toast owes is made here, immediately,
 * because urgency must not wait on a network round trip.
 */
export type ToastId = string | number

export interface ToastAction {
  readonly label: string
  readonly onClick: () => void
}

export interface ShowToastOptions {
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly tone?: ToastTone
  /**
   * A single primary action. Its presence overrides `duration`: a toast with
   * an action stays up until the reader dismisses it or acts on it, per
   * `docs/design/feedback.md`, rather than timing out from under them.
   */
  readonly action?: ToastAction
  /** A secondary, always-dismissing action, laid out beside `action`. */
  readonly cancel?: ToastAction
  /** Milliseconds before the toast auto-dismisses. Ignored when `action` is set. */
  readonly duration?: number
}

/**
 * A promise's settled state: a title, and optionally the one action that
 * follows naturally from it — Reload, Open, Undo — and nothing else
 * (`docs/design/feedback.md`). Either may depend on the resolved value (or,
 * for `error`, the rejection reason).
 */
export interface ToastPromiseOutcome<Value> {
  readonly title: ReactNode | ((value: Value) => ReactNode)
  readonly action?: ToastAction | ((value: Value) => ToastAction)
}

export type ToastPromiseMessage<Value> =
  | ReactNode
  | ToastPromiseOutcome<Value>
  | ((value: Value) => ReactNode | ToastPromiseOutcome<Value>)

export interface ToastPromiseMessages<Data> {
  readonly loading: ReactNode
  readonly success: ToastPromiseMessage<Data>
  readonly error: ToastPromiseMessage<unknown>
}

export interface ToastPromiseOptions {
  /**
   * Reuse an id an earlier `toast.promise` call returned, so a retry updates
   * that toast in place instead of stacking a second one
   * (`docs/design/feedback.md`: "one promise toast per process").
   */
  readonly id?: ToastId
}

/**
 * The seam between the vocabulary above and whatever actually draws a toast
 * (rule 19: a port, with one adapter). Every method takes the id this module
 * minted, so a caller gets one back synchronously whether or not the host has
 * arrived yet.
 */
export interface ToastSink {
  readonly show: (id: ToastId, options: ShowToastOptions) => void
  readonly promise: <Data>(
    id: ToastId,
    input: Promise<Data> | (() => Promise<Data>),
    messages: ToastPromiseMessages<Data>,
  ) => void
  readonly dismiss: (id: ToastId | undefined) => void
}

type SinkCall = (sink: ToastSink) => void

let sink: ToastSink | undefined
const held: SinkCall[] = []

function send(call: SinkCall): void {
  if (sink === undefined) {
    held.push(call)
    return
  }
  call(sink)
}

/**
 * Installs the adapter and replays anything raised before it arrived; the
 * returned function uninstalls it, which is what the host's effect calls when
 * it unmounts (a second host would otherwise inherit the first one's stack).
 *
 * Not `setToastSink`: nothing here is React state, and the name matters —
 * `quill/no-set-state-in-effect` reads a `set…` call in an effect body as the
 * state-as-command-bus shape rule 6 forbids, which this is the opposite of.
 * This *is* the synchronisation with an external system an effect is for.
 */
export function installToastSink(next: ToastSink): () => void {
  sink = next
  const pending = held.splice(0)
  for (const call of pending) call(next)
  return () => {
    if (sink === next) sink = undefined
  }
}

// A deterministic counter rather than `crypto.randomUUID()` (ADR-021,
// `quill/inject-system-dependencies`): the id only has to be unique among
// toasts on screen, which a counter already guarantees without a system
// dependency this module would otherwise have to have injected into it.
let toastSequence = 0

function nextToastId(): string {
  toastSequence += 1
  return `toast-${toastSequence}`
}

function toPlainText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  // A richer node (an element, a list) has no plain-text form worth
  // announcing twice; the polite region still carries it for every tone.
  return ''
}

function announceDangerAssertively(title: ReactNode, description?: ReactNode): void {
  const titleText = toPlainText(title)
  if (titleText === '') return
  const descriptionText = description === undefined ? '' : toPlainText(description)
  const message = descriptionText === '' ? titleText : `${titleText}. ${descriptionText}`
  // Prefixed with the tone word, the same one the visible toast speaks
  // (`toneTitle`): this text never collides with the toast's own plain text,
  // which matters because both are simultaneously findable in the DOM.
  announceAssertively(`${DANGER_TONE_LABEL}: ${message}`)
}

/** Shows a toast. Returns the id it was given, immediately. */
function show(options: ShowToastOptions): ToastId {
  const id = nextToastId()
  if (options.tone === 'danger') announceDangerAssertively(options.title, options.description)
  send((installed) => {
    installed.show(id, options)
  })
  return id
}

type ToneShortcutOptions = Omit<ShowToastOptions, 'title' | 'tone'>

function toneShortcut(tone: ToastTone) {
  return (title: ReactNode, options: ToneShortcutOptions = {}): ToastId =>
    show({ ...options, title, tone })
}

/**
 * Shows a toast that tracks a promise: `loading` while it is pending, then
 * `success` or `error` once it settles, all three the same element re-toned
 * in place. Returns the id immediately, before the promise settles — pass it
 * back as `options.id` on a retry to replace this toast rather than stack a
 * new one.
 */
function promise<Data>(
  input: Promise<Data> | (() => Promise<Data>),
  messages: ToastPromiseMessages<Data>,
  options: ToastPromiseOptions = {},
): ToastId {
  const id = options.id ?? nextToastId()
  // A rejection handler, attached now rather than when the host arrives: an
  // already-rejected promise handed over while the sink is still missing
  // would otherwise surface as an unhandled rejection — a process-level
  // warning for exactly the failure this toast exists to report. The adapter
  // attaches its own; this one only keeps the window covered.
  if (typeof input !== 'function') void input.catch(() => undefined)
  send((installed) => {
    installed.promise(id, input, messages)
  })
  return id
}

/**
 * The typed API the rest of the codebase depends on. No module outside
 * `sonner-toaster.tsx` imports a toast library.
 */
export const toast = {
  show,
  success: toneShortcut('success'),
  info: toneShortcut('info'),
  warning: toneShortcut('warning'),
  danger: toneShortcut('danger'),
  promise,
  /** Dismisses one toast, or every toast when `id` is omitted. */
  dismiss: (id?: ToastId): void => {
    send((installed) => {
      installed.dismiss(id)
    })
  },
}
