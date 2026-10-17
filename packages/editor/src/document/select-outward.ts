import { AllSelection, TextSelection } from '@tiptap/pm/state'
import type { Command, EditorState, Selection } from '@tiptap/pm/state'

import { selectTable } from '../table/table-commands.ts'

/**
 * Select all, a step at a time, outwards from where the caret is.
 *
 * The whole document is rarely what someone pressing it means: in a table cell they mean the cell,
 * in a list item the item. So the first press takes the text of the block the caret is in, and each
 * press after it takes the next thing around that: a list item, the list, a callout, a table, and
 * last the document. A block with nothing in it, or with nothing more than what is already selected,
 * is passed over, so no press is spent selecting what was selected already.
 */

/** What selecting the block at `depth` above `$pos` would select, or undefined when nothing is meant by it. */
function scopeAt(
  state: EditorState,
  $pos: Selection['$from'],
  depth: number,
): Selection | undefined {
  if (depth === 0) return new AllSelection(state.doc)
  const node = $pos.node(depth)
  // A row is a strip of cells: its text selected is a stripe across the table, not a thing anyone has.
  if (node.type.name === 'tableRow') return undefined
  if (node.type.name === 'table') {
    let table: Selection | undefined
    selectTable($pos.before(depth))(state, (tr) => {
      table = tr.selection
    })
    return table
  }
  return TextSelection.between(
    state.doc.resolve($pos.start(depth)),
    state.doc.resolve($pos.end(depth)),
  )
}

/**
 * The stretch of document a selection covers. A selection of cells is a set of ranges, one a cell,
 * and its own `from` and `to` are those of one of them, not of the whole.
 */
function extent({ ranges }: Selection): { readonly from: number; readonly to: number } {
  return {
    from: Math.min(...ranges.map((range) => range.$from.pos)),
    to: Math.max(...ranges.map((range) => range.$to.pos)),
  }
}

/** Whether `scope` takes in all of `current` and something besides. */
function widens(scope: Selection, current: Selection): boolean {
  const wide = extent(scope)
  const narrow = extent(current)
  return (
    wide.from <= narrow.from &&
    wide.to >= narrow.to &&
    (wide.from < narrow.from || wide.to > narrow.to)
  )
}

/** The nearest selection around the current one that takes in more, or undefined when it is everything. */
function nextScope(state: EditorState): Selection | undefined {
  const { selection } = state
  const { $from } = selection
  for (let depth = $from.sharedDepth(selection.to); depth >= 0; depth -= 1) {
    const scope = scopeAt(state, $from, depth)
    if (scope !== undefined && widens(scope, selection)) return scope
  }
  return undefined
}

export const selectOutward: Command = (state, dispatch) => {
  const scope = nextScope(state)
  if (scope !== undefined) dispatch?.(state.tr.setSelection(scope).scrollIntoView())
  // With everything selected there is nowhere further to go, and the browser's own select-all would
  // only reselect it.
  return true
}
