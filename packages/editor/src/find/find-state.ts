import type { Node as PMNode } from '@tiptap/pm/model'
import type { Selection } from '@tiptap/pm/state'

import { findMatches } from './find-matches.ts'
import type { Found, Match } from './find-matches.ts'
import { compilePattern } from './find-pattern.ts'
import type { FindOptions, Pattern } from './find-pattern.ts'

/**
 * What find and replace holds, and how it changes.
 *
 * The state is the editor's own, in a ProseMirror plugin, so it moves with the document: it is
 * found again when the text changes, its stretch to search in moves with the edits, and the bar that
 * shows it is a view of it with nothing of its own to keep in step. `reduceFind` is a pure function
 * of the state, an action and the document, so it is tested without an editor.
 */

/** The toggles of the find bar: VS Code's match case, whole word and regular expression, preserve case, and find in selection. */
export interface FindSettings extends FindOptions {
  /** Search only the stretch that was selected when this was turned on. */
  readonly inSelection: boolean
}

export interface FindState {
  readonly open: boolean
  /** The replace row is showing. */
  readonly replacing: boolean
  readonly query: string
  readonly replacement: string
  readonly settings: FindSettings
  /** The stretch searched when `settings.inSelection` is on. */
  readonly scope: Match | undefined
  readonly pattern: Pattern
  readonly found: Found
  /** Which match the selection is on, or -1. */
  readonly current: number
  /** How many times it has been asked for, so a bar that is open can tell it was asked again. */
  readonly asked: number
  /** The field that takes the keyboard when it is asked for. */
  readonly focus: FindField
}

export type FindField = 'find' | 'replace'

/** What changes in a state when the bar is used. Absent fields stay as they are. */
export interface FindPatch {
  readonly query?: string
  readonly replacement?: string
  readonly replacing?: boolean
  readonly options?: Partial<FindSettings>
}

export type FindAction =
  | { readonly type: 'open'; readonly replacing: boolean; readonly query?: string }
  | { readonly type: 'close' }
  /** Asked for again from inside the bar: the query stays, and the keyboard goes to `field`. */
  | { readonly type: 'show'; readonly field: FindField }
  | { readonly type: 'edit'; readonly patch: FindPatch }
  /** The document changed under the search: look again. */
  | { readonly type: 'refresh' }
  /** A match was replaced: look again, and the plugin goes on to the next one. */
  | { readonly type: 'advance' }
  /** Find itself moved the selection to a match, which is not the writer choosing something else to search in. */
  | { readonly type: 'step' }
  /**
   * The writer chose something else in the document. When searching in a selection, what is searched
   * follows it: a new selection becomes the stretch, and a caret, which selects nothing, ends it.
   */
  | { readonly type: 'reselect' }

const NOTHING_FOUND: Found = { matches: [], truncated: false }

export const INITIAL_FIND: FindState = {
  open: false,
  replacing: false,
  query: '',
  replacement: '',
  settings: {
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    preserveCase: false,
    inSelection: false,
  },
  scope: undefined,
  pattern: { kind: 'empty' },
  found: NOTHING_FOUND,
  current: -1,
  asked: 0,
  focus: 'find',
}

/** Which match the selection is exactly on, or -1. */
export function currentMatch(found: Found, selection: Selection): number {
  return found.matches.findIndex(
    (match) => match.from === selection.from && match.to === selection.to,
  )
}

/** The state with what it finds worked out afresh: nothing while closed or with nothing to look for. */
function searched(state: FindState, doc: PMNode, selection: Selection): FindState {
  const pattern = state.open ? compilePattern(state.query, state.settings) : INITIAL_FIND.pattern
  const found =
    pattern.kind === 'ok'
      ? findMatches(doc, pattern, state.settings.inSelection ? state.scope : undefined)
      : NOTHING_FOUND
  return { ...state, pattern, found, current: currentMatch(found, selection) }
}

/** The settings after a patch: finding in a selection needs one, and takes the one there is. */
function settingsAfter(
  state: FindState,
  options: Partial<FindSettings> | undefined,
  selection: Selection,
): Pick<FindState, 'settings' | 'scope'> {
  const settings = { ...state.settings, ...options }
  if (!settings.inSelection) return { settings, scope: undefined }
  if (state.settings.inSelection) return { settings, scope: state.scope }
  const scope = selection.empty ? undefined : { from: selection.from, to: selection.to }
  return { settings: { ...settings, inSelection: scope !== undefined }, scope }
}

export function reduceFind(
  state: FindState,
  action: FindAction,
  context: { readonly doc: PMNode; readonly selection: Selection },
): FindState {
  const { doc, selection } = context
  switch (action.type) {
    case 'open': {
      const query = action.query ?? state.query
      return searched(
        {
          ...state,
          open: true,
          replacing: action.replacing,
          query,
          asked: state.asked + 1,
          // Replacing something already looked for starts in the replace field; otherwise in find.
          focus: action.replacing && query !== '' ? 'replace' : 'find',
        },
        doc,
        selection,
      )
    }
    case 'show':
      return {
        ...state,
        replacing: state.replacing || action.field === 'replace',
        asked: state.asked + 1,
        focus: action.field,
      }
    case 'close':
      return searched({ ...state, open: false }, doc, selection)
    case 'edit': {
      const { patch } = action
      return searched(
        {
          ...state,
          query: patch.query ?? state.query,
          replacement: patch.replacement ?? state.replacement,
          replacing: patch.replacing ?? state.replacing,
          ...settingsAfter(state, patch.options, selection),
        },
        doc,
        selection,
      )
    }
    case 'refresh':
    case 'advance':
      return searched(state, doc, selection)
    case 'step':
      return { ...state, current: currentMatch(state.found, selection) }
    case 'reselect': {
      const scope = selection.empty ? undefined : { from: selection.from, to: selection.to }
      return searched(
        { ...state, scope, settings: { ...state.settings, inSelection: scope !== undefined } },
        doc,
        selection,
      )
    }
  }
}
