import { Extension } from '@tiptap/core'

import { SHORTCUTS } from '../format/shortcuts.ts'

/**
 * Ctrl+/ (⌘/ on a Mac) opens the list of keyboard shortcuts. The editor does not draw the list
 * itself: it says it was asked for, and whoever mounts the editor shows it.
 */
export function shortcutsHelp(open: () => void): Extension {
  return Extension.create({
    name: 'shortcutsHelp',
    addKeyboardShortcuts: () => ({
      [SHORTCUTS.shortcuts]: () => {
        open()
        return true
      },
    }),
  })
}
