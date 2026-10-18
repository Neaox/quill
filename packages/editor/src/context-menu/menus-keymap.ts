import { Extension } from '@tiptap/core'
import type { RefObject } from 'react'

import { moveBlock } from '../block/commands.ts'
import { clearFormatting } from '../format/format-commands.ts'
import { SHORTCUTS } from '../format/shortcuts.ts'
import { openLinkPopover } from '../link/open-link-popover.ts'
import type { OverlayStore } from './overlay-store.ts'

/**
 * The keys that reach the writing surface's menus and toolbars, bound from
 * the one list their labels are read from (`format/shortcuts.ts`).
 *
 * Ctrl+K belongs to the link popover while focus is in the document, and is
 * always claimed here, even where there is nothing to link: the application's
 * search, which answers Ctrl+K everywhere else, stands aside for a key the
 * page has already handled, so the shortcut is scoped by where focus is.
 */

export interface MenusKeymapOptions {
  readonly store: OverlayStore
  /** The selection toolbar's way of taking focus, set while it is shown. */
  readonly focusToolbar: RefObject<() => boolean>
}

export function menusKeymap(options: MenusKeymapOptions): Extension {
  return Extension.create({
    name: 'menusKeymap',
    priority: 1050,
    addKeyboardShortcuts() {
      const view = () => this.editor.view
      const focusToolbar = (): boolean => options.focusToolbar.current()
      return {
        [SHORTCUTS.link]: () => {
          openLinkPopover(view(), options.store)
          return true
        },
        [SHORTCUTS.clearFormatting]: () => clearFormatting(view().state, view().dispatch),
        [SHORTCUTS.toolbar]: focusToolbar,
        [SHORTCUTS.toolbarAlternative]: focusToolbar,
        [SHORTCUTS.moveUp]: () => moveBlock(-1)(view().state, view().dispatch),
        [SHORTCUTS.moveDown]: () => moveBlock(1)(view().state, view().dispatch),
      }
    },
  })
}
