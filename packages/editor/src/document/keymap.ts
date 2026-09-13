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
import { insertHardBreak } from './commands.ts'

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

const LIST_KEYS: Readonly<Record<string, string>> = {
  'Mod-Shift-7': 'orderedList',
  'Mod-Shift-8': 'bulletList',
  'Mod-Shift-9': 'taskList',
}

const ITEM_NODES = ['listItem', 'taskItem'] as const

/** One command per list item type, tried in turn, so both kinds of list work. */
function acrossItemTypes(schema: Schema, make: (type: NodeType) => Command): Command {
  return chainCommands(...ITEM_NODES.map((name) => make(nodeType(schema, name))))
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
    Object.entries(LIST_KEYS).map(([key, name]) => [key, wrapInList(nodeType(schema, name))]),
  )

  return {
    ...marks,
    ...headings,
    ...lists,
    'Mod-Alt-0': setBlockType(nodeType(schema, 'paragraph')),
    'Mod-Alt-c': setBlockType(nodeType(schema, 'codeBlock')),
    'Shift-Enter': insertHardBreak,
    Enter: acrossItemTypes(schema, splitListItem),
    Tab: chainCommands(tableCommands.nextCell, acrossItemTypes(schema, sinkListItem)),
    'Shift-Tab': chainCommands(tableCommands.previousCell, acrossItemTypes(schema, liftListItem)),
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
