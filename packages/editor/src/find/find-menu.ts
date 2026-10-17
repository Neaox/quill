import { SearchIcon } from '@quill/ui'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import type { ContextMenuContribution, MenuAction } from '../context-menu/context-menu-registry.ts'
import { shortcutFor } from '../format/shortcuts.ts'
import { openFind } from './find-commands.ts'
import { findStateOf } from './find-plugin.ts'

/**
 * Find and replace where a writer looks for it besides the keyboard: the context menu's "Find and
 * replace…" anywhere in the document, and "Find in document" for selected words, in that menu
 * and on the selection toolbar. Each opens the find bar (ADR-051) with the words selected, if
 * any, as what is looked for, exactly as Ctrl+F and Ctrl+H do.
 */

export const FIND_IN_DOCUMENT = 'Find in document'
export const FIND_AND_REPLACE = 'Find and replace…'

/** Why the selected words cannot be looked for, or undefined when they can: find looks within one line. */
export function findSelectionUnavailable(state: EditorState): string | undefined {
  const { empty, $from, $to } = state.selection
  if (empty) return 'Select some words first'
  return $from.sameParent($to) ? undefined : 'Select words on one line to find them'
}

/** Opens the find bar, from a menu: the keyboard goes to its field, so the menu hands it no focus back. */
export function openFindFrom(view: EditorView, replacing: boolean): void {
  openFind(replacing)(view.state, view.dispatch, view)
}

export const findMenu: ContextMenuContribution = {
  id: 'find',
  order: 50,
  entries: ({ view, state }) => {
    // An editor without find has nothing here.
    if (findStateOf(state) === undefined) return []
    const entries: MenuAction[] = [
      {
        kind: 'action',
        id: 'find-and-replace',
        label: FIND_AND_REPLACE,
        icon: SearchIcon,
        shortcut: shortcutFor('replace'),
        run: () => {
          openFindFrom(view, true)
        },
      },
    ]
    if (state.selection.empty) return entries
    return [
      {
        kind: 'action',
        id: 'find-in-document',
        label: FIND_IN_DOCUMENT,
        icon: SearchIcon,
        shortcut: shortcutFor('find'),
        disabledReason: findSelectionUnavailable(state),
        run: () => {
          openFindFrom(view, false)
        },
      },
      ...entries,
    ]
  },
}
