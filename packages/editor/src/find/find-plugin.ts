import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Selection, Transaction } from '@tiptap/pm/state'
import type { Mapping } from '@tiptap/pm/transform'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import type { Found, Match } from './find-matches.ts'
import { refindChanged } from './find-refresh.ts'
import type { Refound } from './find-refresh.ts'
import { currentMatch, INITIAL_FIND, reduceFind } from './find-state.ts'
import type { FindAction, FindState } from './find-state.ts'

/**
 * Find and replace as a ProseMirror plugin: its state, the highlights it draws, and the step on to
 * the next match after one is replaced.
 *
 * Everything the bar shows is read from `findKey`'s state and everything it does is a command in
 * `find-commands.ts`, so the plugin is the one owner of what find knows.
 *
 * It costs nothing while the bar is closed: a transaction then returns the state it was given. While
 * the bar is open an edit is searched again only where it was (`find-refresh.ts`), and the
 * highlights are mapped through it and redrawn only there, so a keystroke with the bar open walks
 * one block, not the document (quill-plan.md section 31).
 */

export const findKey = new PluginKey<FindState>('find')

/** The state of find, or undefined in an editor without it. */
export const findStateOf = (state: EditorState): FindState | undefined => findKey.getState(state)

/** Where the stretch searched is after an edit: what was inside it stays inside. */
function movedScope(scope: Match | undefined, mapping: Mapping): Match | undefined {
  return scope === undefined
    ? undefined
    : { from: mapping.map(scope.from), to: mapping.map(scope.to) }
}

/** Every match is drawn once per search, not once per keystroke or per move of the caret. */
const drawn = new WeakMap<Found, DecorationSet>()

const matchDecoration = ({ from, to }: Match) =>
  Decoration.inline(from, to, { class: 'find-match' }, { find: 'match' })

function marked(state: EditorState, found: Found): DecorationSet {
  const known = drawn.get(found)
  if (known !== undefined) return known
  const set = DecorationSet.create(state.doc, found.matches.map(matchDecoration))
  drawn.set(found, set)
  return set
}

/**
 * The highlights for a state: each match, the one the selection is on as the current one, the
 * selection itself, which a browser stops painting once the bar has the keyboard (as the toolbar's
 * link box does, `held-selection.ts`), and, when searching in a selection, the stretch it searches.
 */
export function findDecorations(state: EditorState): DecorationSet {
  const find = findStateOf(state)
  if (find === undefined || !find.open) return DecorationSet.empty
  const current = find.found.matches[find.current]
  const { scope } = find
  const { selection } = state
  const extra = [
    // The selection stays drawn while the keyboard is in the bar, which stops a browser painting it.
    ...(selection instanceof TextSelection && !selection.empty
      ? [
          Decoration.inline(
            selection.from,
            selection.to,
            { class: 'selection-held' },
            { find: 'selection' },
          ),
        ]
      : []),
    // Where a search in a selection is looking, which stays drawn as the selection moves on to the matches.
    ...(find.settings.inSelection && scope !== undefined
      ? [Decoration.inline(scope.from, scope.to, { class: 'find-scope' }, { find: 'scope' })]
      : []),
    ...(current === undefined
      ? []
      : [
          Decoration.inline(
            current.from,
            current.to,
            { class: 'find-match-current' },
            { find: 'current' },
          ),
        ]),
  ]
  const all = marked(state, find.found)
  return extra.length === 0 ? all : all.add(state.doc, extra)
}

const isMatch = (spec: { readonly [key: string]: unknown }): boolean => spec['find'] === 'match'

/**
 * The highlights after an edit, from those before it: mapped through it, and redrawn in the blocks
 * that were searched again. Nothing is kept when the whole document was, or the count was cut short.
 */
function remark(before: Found, refound: Refound, doc: PMNode, transaction: Transaction): void {
  const known = drawn.get(before)
  const { changed, found, fresh } = refound
  if (known === undefined || changed === undefined || found.truncated) return
  const set = changed.reduce(
    (next, { from, to }) => {
      const stale = next
        .find(from, to, isMatch)
        .filter((item) => item.from >= from && item.to <= to)
      return next.remove(stale)
    },
    known.map(transaction.mapping, doc),
  )
  drawn.set(found, set.add(doc, fresh.map(matchDecoration)))
}

/** The state after an edit with the bar open: what it finds, found again where the edit was. */
function refreshed(state: FindState, transaction: Transaction, selection: Selection): FindState {
  if (state.pattern.kind !== 'ok') return state
  const scope = state.settings.inSelection ? state.scope : undefined
  const refound = refindChanged(state.found, transaction, state.pattern, scope)
  remark(state.found, refound, transaction.doc, transaction)
  return { ...state, found: refound.found, current: currentMatch(refound.found, selection) }
}

export function findPlugin(): Plugin<FindState> {
  return new Plugin<FindState>({
    key: findKey,
    state: {
      init: () => INITIAL_FIND,
      apply(transaction, previous, _before, state) {
        const action: FindAction | undefined = transaction.getMeta(findKey)
        // Closed, find has nothing to keep up with: no work on a keystroke.
        if (action === undefined && !previous.open) return previous
        const moved = transaction.docChanged
          ? { ...previous, scope: movedScope(previous.scope, transaction.mapping) }
          : previous
        // An edit, the writer's or a replacement's, is searched again where it was.
        if (transaction.docChanged && (action === undefined || action.type === 'advance')) {
          return refreshed(moved, transaction, state.selection)
        }
        const context = { doc: transaction.doc, selection: state.selection }
        if (action !== undefined) return reduceFind(moved, action, context)
        if (!transaction.selectionSet) return previous
        // Searching in a selection, a new selection of the writer's is the stretch searched.
        if (previous.settings.inSelection)
          return reduceFind(previous, { type: 'reselect' }, context)
        const current = currentMatch(previous.found, state.selection)
        return current === previous.current ? previous : { ...previous, current }
      },
    },
    props: { decorations: findDecorations },
    // After a match is replaced, the selection goes on to the next one, as one step with it.
    appendTransaction(transactions, _before, state) {
      if (!transactions.some((transaction) => transaction.getMeta(findKey)?.type === 'advance')) {
        return null
      }
      // The state exists: this plugin's own transaction asked for the step.
      /* v8 ignore next */
      const matches = findStateOf(state)?.found.matches ?? []
      const next = matches.find((match) => match.from >= state.selection.to) ?? matches[0]
      return next === undefined
        ? null
        : state.tr
            .setSelection(TextSelection.create(state.doc, next.from, next.to))
            .setMeta(findKey, { type: 'step' })
            .scrollIntoView()
    },
  })
}
