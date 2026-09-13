/**
 * Where a presentation is, and what moves it.
 *
 * The reducer is a pure function of a position and an event
 * (`docs/architecture/patterns.md`), and the position it reduces lives in the
 * URL rather than in a store: `?step=3` is the whole of the presentation's
 * state, so a refresh, a second screen, and a link shared into a chat all land
 * on the same section. `PresentRoute` reads the URL, reduces, and navigates;
 * nothing here knows about the router.
 */

export interface StepState {
  /** The step being presented, counted from zero. */
  readonly index: number
  /** How many steps the document has. */
  readonly count: number
}

export type StepEvent =
  | { readonly type: 'next' }
  | { readonly type: 'previous' }
  | { readonly type: 'first' }
  | { readonly type: 'last' }
  | { readonly type: 'go-to'; readonly index: number }

/** The last step of a presentation, or zero when there is nothing to present. */
function lastIndex(count: number): number {
  return Math.max(0, count - 1)
}

function clamp(index: number, count: number): number {
  if (!Number.isFinite(index)) return 0
  return Math.min(lastIndex(count), Math.max(0, Math.trunc(index)))
}

/**
 * The next position.
 *
 * A presentation does not wrap. Pressing forward on the last section in front
 * of a room must not send everyone back to the title slide, and pressing back
 * on the first must not jump to the end; both simply stay put, and the
 * identical state object comes back so a caller can tell nothing moved without
 * comparing fields.
 */
export function presentReducer(state: StepState, event: StepEvent): StepState {
  const index = clamp(state.index, state.count)
  const moved = ((): number => {
    switch (event.type) {
      case 'next': {
        return index + 1
      }
      case 'previous': {
        return index - 1
      }
      case 'first': {
        return 0
      }
      case 'last': {
        return lastIndex(state.count)
      }
      case 'go-to': {
        return event.index
      }
    }
  })()
  const next = clamp(moved, state.count)
  return next === state.index ? state : { index: next, count: state.count }
}

/**
 * The step a URL asks for, as an index.
 *
 * `?step=` is one-based, because it is read aloud and typed by people, and an
 * absent, malformed, or out-of-range value is the first step rather than an
 * error: a link that has outlived a section must still open the document.
 */
export function stepFromSearch(step: number | undefined, count: number): number {
  return step === undefined ? 0 : clamp(step - 1, count)
}

/** What a key press asks a presentation to do. */
export type PresentCommand =
  | { readonly kind: 'step'; readonly event: StepEvent }
  | { readonly kind: 'exit' }
  | { readonly kind: 'go-to' }
  | { readonly kind: 'notes' }

export interface KeyPress {
  readonly key: string
  readonly ctrlKey?: boolean
  readonly metaKey?: boolean
  readonly altKey?: boolean
}

const STEP_KEYS: Readonly<Record<string, StepEvent>> = {
  ArrowRight: { type: 'next' },
  PageDown: { type: 'next' },
  ' ': { type: 'next' },
  ArrowLeft: { type: 'previous' },
  PageUp: { type: 'previous' },
  Home: { type: 'first' },
  End: { type: 'last' },
}

/**
 * The presenter's keyboard, as a table rather than a chain of conditions.
 *
 * The keys are the ones a presentation remote sends (most send Page Up and
 * Page Down, or the arrows) plus the ones a person at a laptop reaches for.
 * A press carrying a modifier is somebody's browser shortcut, not a step, so
 * it is left alone: Ctrl+Home belongs to the page, and Cmd+Left to history.
 */
export function commandForKey(press: KeyPress): PresentCommand | undefined {
  if (press.ctrlKey === true || press.metaKey === true || press.altKey === true) return undefined

  const step = STEP_KEYS[press.key]
  if (step !== undefined) return { kind: 'step', event: step }

  switch (press.key.toLowerCase()) {
    case 'escape': {
      return { kind: 'exit' }
    }
    case 'g': {
      return { kind: 'go-to' }
    }
    case 'n': {
      return { kind: 'notes' }
    }
    default: {
      return undefined
    }
  }
}
