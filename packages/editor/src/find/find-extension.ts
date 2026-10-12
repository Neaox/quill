import { Extension } from '@tiptap/core'
import type { KeyboardShortcutCommand } from '@tiptap/core'
import type { Command } from '@tiptap/pm/state'

import { closeFind, findNext, findPrevious, openFind } from './find-commands.ts'
import { findPlugin, findStateOf } from './find-plugin.ts'

/**
 * Find and replace in the editor: the plugin that holds it and the keys that reach it, which are
 * VS Code's. Ctrl+F opens find and Ctrl+H the replace row too (Ctrl+Alt+F as well, since a Mac's
 * Command+H hides the window); F3 and Ctrl+G step on and Shift with either steps back; Escape
 * closes it, but only while it is open, so it stays free for what else it does.
 */

/** A command that applies only while the find bar is open. */
const whileOpen =
  (command: Command): Command =>
  (state, dispatch, view) =>
    findStateOf(state)?.open === true && command(state, dispatch, view)

const bound =
  (command: Command): KeyboardShortcutCommand =>
  ({ editor }) =>
    command(editor.state, editor.view.dispatch, editor.view)

export const FindAndReplace = Extension.create({
  name: 'findAndReplace',
  addProseMirrorPlugins: () => [findPlugin()],
  addKeyboardShortcuts: () => ({
    'Mod-f': bound(openFind(false)),
    'Mod-h': bound(openFind(true)),
    'Mod-Alt-f': bound(openFind(true)),
    F3: bound(whileOpen(findNext)),
    'Mod-g': bound(whileOpen(findNext)),
    'Shift-F3': bound(whileOpen(findPrevious)),
    'Mod-Shift-g': bound(whileOpen(findPrevious)),
    Escape: bound(whileOpen(closeFind)),
  }),
})
