import { Extension } from '@tiptap/core'
import type { NodeType, Schema } from '@tiptap/pm/model'
import { chainCommands, setBlockType, toggleMark } from '@tiptap/pm/commands'
import { dropCursor } from '@tiptap/pm/dropcursor'
import { gapCursor } from '@tiptap/pm/gapcursor'
import { history, redo, undo } from '@tiptap/pm/history'
import { liftListItem, sinkListItem, splitListItem, wrapInList } from '@tiptap/pm/schema-list'
import type { Command } from '@tiptap/pm/state'

import { markType, nodeType } from '../schema/node-type.ts'
import { tableCommands } from '../schema/tables.ts'
import { moveBlock } from '../block/commands.ts'
import { tableKeymap } from '../table/table-actions.ts'
import { enterInTable, goToCell, nextCellOrNewRow } from '../table/table-commands.ts'
import { tableContext } from '../table/table-context.ts'
import { insertHardBreak } from './commands.ts'
import { enterTable } from './enter-table.ts'
import { leaveEnd, leaveStart } from './exit-block.ts'
import { selectOutward } from './select-outward.ts'
import { selectNextOccurrence } from './select-next-occurrence.ts'
import { SHORTCUTS } from '../format/shortcuts.ts'
import { currentKind, turnInto } from '../format/turn-into.ts'
import type { TurnIntoTarget } from '../format/turn-into.ts'

/**
 * The editor's keyboard map.
 *
 * TipTap's core extension already binds Enter, Backspace, Delete and select-all;
 * everything a writer reaches for beyond those is here, as ProseMirror commands
 * over the published schema. Each binding is a command, so the same behaviour is
 * available to a menu item and to a test without a keyboard.
 *
 * Every command returns false when it does not apply, which is how one Enter
 * binding can split a list item inside a list and leave paragraphs to the core
 * handler outside one.
 */

const MARK_KEYS: Readonly<Record<string, string>> = {
  'Mod-b': 'bold',
  'Mod-i': 'italic',
  'Mod-Shift-x': 'strike',
  'Mod-e': 'code',
}

const LIST_KEYS: Readonly<Record<string, ListKind>> = {
  'Mod-Shift-7': { node: 'orderedList', kind: 'numbered-list' },
  'Mod-Shift-8': { node: 'bulletList', kind: 'bullet-list' },
  'Mod-Shift-9': { node: 'taskList', kind: 'task-list' },
}

interface ListKind {
  readonly node: string
  readonly kind: TurnIntoTarget
}

const LIST_KINDS: ReadonlySet<TurnIntoTarget> = new Set(
  Object.values(LIST_KEYS).map(({ kind }) => kind),
)

/**
 * A list's key is a switch, as the toolbar's list buttons are: it makes the
 * line that list, turns it back into text in that list, and changes another
 * kind of list into this one rather than nesting one in the other.
 */
function toggleList(schema: Schema, { node, kind }: ListKind): Command {
  return (state, dispatch, view) => {
    const current = currentKind(state)
    if (current === kind) return turnInto('paragraph')(state, dispatch, view)
    if (current !== undefined && LIST_KINDS.has(current)) {
      return turnInto(kind)(state, dispatch, view)
    }
    return wrapInList(nodeType(schema, node))(state, dispatch, view)
  }
}

const ITEM_NODES = ['listItem', 'taskItem'] as const

/** One command per list item type, tried in turn, so both kinds of list work. */
function acrossItemTypes(schema: Schema, make: (type: NodeType) => Command): Command {
  return chainCommands(...ITEM_NODES.map((name) => make(nodeType(schema, name))))
}

/**
 * The table's command while the selection is in a table, which may decline
 * (a first row has nowhere up to go), and `elsewhere` everywhere else.
 */
function inTableOr(inTable: Command | undefined, elsewhere: Command): Command {
  return (state, dispatch, view) =>
    tableContext(state) === undefined
      ? elsewhere(state, dispatch, view)
      : (inTable?.(state, dispatch, view) ??
        /* v8 ignore start -- the table's keymap binds both keys; this only narrows its index type. */
        false)
  /* v8 ignore stop */
}

export function keyboardShortcuts(schema: Schema): Readonly<Record<string, Command>> {
  const headings = Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((level) => [
      `Mod-Alt-${String(level)}`,
      setBlockType(nodeType(schema, 'heading'), { level }),
    ]),
  )
  const marks = Object.fromEntries(
    Object.entries(MARK_KEYS).map(([key, name]) => [key, toggleMark(markType(schema, name))]),
  )
  const lists = Object.fromEntries(
    Object.entries(LIST_KEYS).map(([key, list]) => [key, toggleList(schema, list)]),
  )
  const table = tableKeymap()

  return {
    ...marks,
    ...headings,
    ...lists,
    'Mod-Alt-0': setBlockType(nodeType(schema, 'paragraph')),
    'Mod-Alt-c': setBlockType(nodeType(schema, 'codeBlock')),
    'Shift-Enter': insertHardBreak,
    // In a table, Enter goes down a cell and adds a row at the end; Tab goes
    // to the next cell and adds a row from the last (ADR-040).
    Enter: chainCommands(enterInTable, acrossItemTypes(schema, splitListItem)),
    Tab: chainCommands(nextCellOrNewRow, acrossItemTypes(schema, sinkListItem)),
    // Inserting, moving and deleting rows and columns, as the table toolbar lists them.
    ...table,
    // In a table Alt+Up and Alt+Down move its rows; anywhere else, the list
    // item or the block (`block/commands.ts`), as an outliner's do.
    'Alt-ArrowUp': inTableOr(table['Alt-ArrowUp'], moveBlock(-1, 'item')),
    'Alt-ArrowDown': inTableOr(table['Alt-ArrowDown'], moveBlock(1, 'item')),
    // One cell at a time, however far into the text the caret is (the plain arrows go a character).
    'Alt-Shift-ArrowUp': goToCell('up'),
    'Alt-Shift-ArrowDown': goToCell('down'),
    'Alt-Shift-ArrowLeft': goToCell('left'),
    'Alt-Shift-ArrowRight': goToCell('right'),
    // Out of a block that has the end or the start of the document, which
    // has nowhere to go (exit-block.ts), and into a table beside the caret,
    // which Firefox's own caret cannot find (enter-table.ts).
    ArrowDown: chainCommands(leaveEnd('down'), enterTable('down')),
    ArrowRight: chainCommands(leaveEnd('right'), enterTable('right')),
    ArrowUp: chainCommands(leaveStart('up'), enterTable('up')),
    ArrowLeft: chainCommands(leaveStart('left'), enterTable('left')),
    'Shift-Tab': chainCommands(tableCommands.previousCell, acrossItemTypes(schema, liftListItem)),
    // The block first, then what is around it, and last the document (select-outward.ts).
    'Mod-a': selectOutward,
    // The word at the caret, then each next place it comes (select-next-occurrence.ts).
    [SHORTCUTS.selectNextOccurrence]: selectNextOccurrence,
    'Mod-z': undo,
    'Mod-y': redo,
    'Mod-Shift-z': redo,
  }
}

/**
 * The keymap as a TipTap extension. Its priority is above the core keymap so a
 * binding here is offered the key first and may decline it.
 *
 * It carries the three plugins those bindings assume: an undo history for
 * `Mod-z`, a drop cursor for dragging a block, and a gap cursor so the caret can
 * sit beside a table or a front matter block that it cannot sit inside.
 */
export const KeyboardShortcuts = Extension.create({
  name: 'keyboardShortcuts',
  priority: 1000,
  addProseMirrorPlugins: () => [history(), dropCursor(), gapCursor()],
  addKeyboardShortcuts() {
    const { schema } = this.editor
    return Object.fromEntries(
      Object.entries(keyboardShortcuts(schema)).map(([key, command]) => [
        key,
        ({ editor }) => command(editor.state, editor.view.dispatch, editor.view),
      ]),
    )
  },
})
