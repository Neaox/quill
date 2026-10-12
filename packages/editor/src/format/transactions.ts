import { Selection } from '@tiptap/pm/state'
import type { Command, EditorState, Transaction } from '@tiptap/pm/state'

/**
 * What a command would do, as the transaction it builds.
 *
 * A ProseMirror command acts by dispatching, which is the right shape for a
 * keybinding and an awkward one for a command made of two others — "leave the
 * list, then make a different one". Capturing the transaction lets such a
 * command be written as the sum of its parts and dispatched once, which is also
 * what makes it one step in the undo history instead of two.
 */
export function transactionOf(command: Command, state: EditorState): Transaction | null {
  const built: Transaction[] = []
  const applies = command(state, (tr) => {
    built.push(tr)
  })
  return applies ? (built[0] ?? null) : null
}

/**
 * Runs commands one after another, each on the document the last one left, and
 * joins what they did into a single transaction, steps and selection. Commands
 * that do not apply are skipped; `null` means none did.
 */
export function inSequence(
  state: EditorState,
  commands: readonly ((current: EditorState) => Command)[],
): Transaction | null {
  let current = state
  const joined = state.tr
  let changed = false
  for (const next of commands) {
    const tr = transactionOf(next(current), current)
    if (tr === null) continue
    for (const step of tr.steps) joined.step(step)
    current = current.apply(tr)
    changed = true
  }
  if (!changed) return null
  // Selection is not a step, so it is carried over by hand; it is rebuilt on
  // the joined transaction's document because a selection belongs to one
  // document instance and the commands each produced their own.
  return joined.setSelection(Selection.fromJSON(joined.doc, current.selection.toJSON()))
}
