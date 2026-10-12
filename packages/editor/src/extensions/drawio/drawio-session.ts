/**
 * One draw.io editing session, as a state machine (`docs/architecture/
 * patterns.md`, "Reducer and state machine").
 *
 * The session is the conversation with the embedded editor and the
 * attachments API, and every way it can go is a state, so an impossible one
 * does not compile: draw.io loading; ready, with or without unsaved changes;
 * saving; saved; a conflict with a newer revision; an error; asking whether to
 * close with unsaved changes; closed. The reducer is pure — what to send and
 * what to request is decided by the component's event handlers, from the
 * state they move to (`drawio-editor.tsx`).
 */

/**
 * What "Try again" does after a failure: open the diagram again, write the
 * save that failed again, or nothing — an editor that never answered is not
 * fixed by asking it again.
 */
export type DrawioRetry = 'open' | 'save' | 'none'

export type DrawioSessionState =
  /** The editor page is loading, or loading the diagram. */
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly dirty: boolean }
  /** Exporting the SVG and writing it; `exit` when "Save & Exit" asked to close after. */
  | { readonly status: 'saving'; readonly exit: boolean; readonly copy: boolean }
  /** Written; the next change makes the session dirty again. */
  | { readonly status: 'saved'; readonly version: number }
  /**
   * Somebody saved a newer revision first. Nothing was written; the writer
   * chooses to save theirs as a copy or to reload theirs away (ADR-043).
   */
  | { readonly status: 'conflict'; readonly exit: boolean; readonly currentVersion: number }
  | {
      readonly status: 'error'
      readonly message: string
      readonly dirty: boolean
      readonly retry: DrawioRetry
    }
  /** Close was asked for with unsaved changes; `back` is where "Keep editing" returns. */
  | { readonly status: 'confirming-close'; readonly back: DrawioSessionState }
  | { readonly status: 'closed' }

export type DrawioSessionEvent =
  | { readonly type: 'loaded' }
  | { readonly type: 'changed' }
  | { readonly type: 'save-requested'; readonly exit: boolean }
  | { readonly type: 'copy-requested' }
  | { readonly type: 'saved'; readonly version: number }
  | { readonly type: 'conflicted'; readonly currentVersion: number }
  | { readonly type: 'failed'; readonly message: string; readonly retry: DrawioRetry }
  | { readonly type: 'retried' }
  | { readonly type: 'reload-requested' }
  | { readonly type: 'close-requested' }
  | { readonly type: 'close-confirmed' }
  | { readonly type: 'close-cancelled' }
  /** draw.io's own Exit, which has already asked about unsaved changes. */
  | { readonly type: 'exited' }

export const initialDrawioSessionState: DrawioSessionState = { status: 'loading' }

/** Whether closing now would lose work, which is when closing asks first. */
export function hasUnsavedChanges(state: DrawioSessionState): boolean {
  switch (state.status) {
    case 'ready':
    case 'error':
      return state.dirty
    case 'saving':
    case 'conflict':
      return true
    case 'confirming-close':
      return hasUnsavedChanges(state.back)
    case 'loading':
    case 'saved':
    case 'closed':
      return false
  }
}

export function drawioSessionReducer(
  state: DrawioSessionState,
  event: DrawioSessionEvent,
): DrawioSessionState {
  if (state.status === 'closed') return state
  switch (event.type) {
    case 'loaded':
      return { status: 'ready', dirty: false }
    case 'changed':
      return state.status === 'ready' || state.status === 'saved'
        ? { status: 'ready', dirty: true }
        : state
    case 'save-requested':
      return state.status === 'saving' ? state : { status: 'saving', exit: event.exit, copy: false }
    case 'copy-requested':
      return state.status === 'conflict'
        ? { status: 'saving', exit: state.exit, copy: true }
        : state
    case 'saved':
      if (state.status !== 'saving') return state
      return state.exit ? { status: 'closed' } : { status: 'saved', version: event.version }
    case 'conflicted':
      return state.status === 'saving'
        ? { status: 'conflict', exit: state.exit, currentVersion: event.currentVersion }
        : state
    case 'failed':
      return {
        status: 'error',
        message: event.message,
        dirty: hasUnsavedChanges(state),
        retry: event.retry,
      }
    case 'retried':
      if (state.status !== 'error' || state.retry === 'none') return state
      return state.retry === 'save'
        ? { status: 'saving', exit: false, copy: false }
        : { status: 'loading' }
    case 'reload-requested':
      return { status: 'loading' }
    case 'close-requested':
      if (state.status === 'confirming-close') return state
      return hasUnsavedChanges(state)
        ? { status: 'confirming-close', back: state }
        : { status: 'closed' }
    case 'close-confirmed':
    case 'exited':
      return { status: 'closed' }
    case 'close-cancelled':
      return state.status === 'confirming-close' ? state.back : state
  }
}
