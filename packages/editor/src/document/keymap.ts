import { Extension } from '@tiptap/core'
import type { NodeType, Schema } from '@tiptap/pm/model'
import { chainCommands, setBlockType } from '@tiptap/pm/commands'
import { dropCursor } from '@tiptap/pm/dropcursor'
import { gapCursor } from '@tiptap/pm/gapcursor'
import { history, redo, undo } from '@tiptap/pm/history'
import { liftListItem, sinkListItem, splitListItem } from '@tiptap/pm/schema-list'
import type { Command } from '@tiptap/pm/state'

import { clearFormatting, INLINE_MARKS, toggleInlineMark } from '../format/marks.ts'
import { TEXT_STYLES, toggleTextStyle } from '../format/text-styles.ts'
import { nodeType } from '../schema/node-type.ts'
import { tableCommands } from '../schema/tables.ts'
import {
  enterInTable,
  goToCell,
  moveColumn,
  moveRow,
  nextCellOrNewRow,
} from '../table/table-commands.ts'
import { tableContext } from '../table/table-context.ts'
import { insertHardBreak } from './commands.ts'
import { enterTable } from './enter-table.ts'
import { leaveEnd, leaveStart } from './exit-block.ts'
import { moveBlock } from './move-block.ts'
import { selectNextOccurrence } from './select-next-occurrence.ts'
import { selectOutward } from './select-outward.ts'

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

const ITEM_NODES = ['listItem', 'taskItem'] as const

/** One command per list item type, tried in turn, so both kinds of list work. */
function acrossItemTypes(schema: Schema, make: (type: NodeType) => Command): Command {
  return chainCommands(...ITEM_NODES.map((name) => make(nodeType(schema, name))))
}

/** Moves the selection's row or column one place, as dragging its grip does. */
function moveLine(axis: 'row' | 'column', by: number): Command {
  return (state, dispatch) => {
    const context = tableContext(state)
    if (context === undefined) return false
    const from = axis === 'row' ? context.rect.top : context.rect.left
    return (axis === 'row' ? moveRow : moveColumn)(from, from + by)(state, dispatch)
  }
}

/** The two deepest heading levels are bound to keys but not offered in menus. */
export const DEEP_HEADING_LEVELS = [5, 6] as const

export function keyboardShortcuts(schema: Schema): Readonly<Record<string, Command>> {
  const deepHeadings = Object.fromEntries(
    DEEP_HEADING_LEVELS.map((level) => [
      `Mod-Alt-${String(level)}`,
      setBlockType(nodeType(schema, 'heading'), { level }),
    ]),
  )
  const marks = Object.fromEntries(
    INLINE_MARKS.map((mark) => [mark.key, toggleInlineMark(mark.name)]),
  )
  const styles = Object.fromEntries(
    TEXT_STYLES.flatMap((style) =>
      style.key === undefined ? [] : [[style.key, toggleTextStyle(style)]],
    ),
  )

  return {
    ...marks,
    'Mod-\\': clearFormatting,
    ...styles,
    ...deepHeadings,
    'Shift-Enter': insertHardBreak,
    // In a table, Enter goes down a cell and adds a row at the end; Tab goes
    // to the next cell and adds a row from the last (ADR-040).
    Enter: chainCommands(enterInTable, acrossItemTypes(schema, splitListItem)),
    Tab: chainCommands(nextCellOrNewRow, acrossItemTypes(schema, sinkListItem)),
    // Out of a block that has the end or the start of the document, which has nowhere to go (exit-block.ts).
    ArrowDown: chainCommands(leaveEnd('down'), enterTable('down')),
    ArrowRight: chainCommands(leaveEnd('right'), enterTable('right')),
    ArrowUp: chainCommands(leaveStart('up'), enterTable('up')),
    ArrowLeft: chainCommands(leaveStart('left'), enterTable('left')),
    // One cell at a time, however far into the text the caret is (the plain arrows go a character).
    'Alt-Shift-ArrowUp': goToCell('up'),
    'Alt-Shift-ArrowDown': goToCell('down'),
    'Alt-Shift-ArrowLeft': goToCell('left'),
    'Alt-Shift-ArrowRight': goToCell('right'),
    // In a table the keys move its rows; anywhere else, the block (move-block.ts).
    'Alt-ArrowUp': chainCommands(moveLine('row', -1), moveBlock(-1)),
    'Alt-ArrowDown': chainCommands(moveLine('row', 1), moveBlock(1)),
    'Alt-ArrowLeft': moveLine('column', -1),
    'Alt-ArrowRight': moveLine('column', 1),
    'Shift-Tab': chainCommands(tableCommands.previousCell, acrossItemTypes(schema, liftListItem)),
    // The block first, then what is around it, and last the document (select-outward.ts).
    'Mod-a': selectOutward,
    // The word, then each next place it comes (select-next-occurrence.ts).
    'Mod-d': selectNextOccurrence,
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
