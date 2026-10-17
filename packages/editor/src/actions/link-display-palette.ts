import type { Editor } from '@tiptap/react'

import { linkTargetAt } from '../link/link-display.ts'
import { LINK_DISPLAY_GROUP } from './link-display-actions.ts'

/**
 * The command palette's view of the editor (ADR-042, "Authoring surface").
 *
 * The palette belongs to the application, so the editor offers it a list of
 * plain commands rather than a way in: a label, the words someone might type,
 * and what to do. They are the same actions the toolbar's "Show link as"
 * control and the context menu run (`link-display-actions.ts`), read for the
 * link at the cursor *now*, so the palette lists only what would work.
 */

export interface EditorPaletteCommand {
  /** Unique across the editor's palette commands. */
  readonly id: string
  readonly label: string
  /** Other words somebody might type for it. */
  readonly keywords: readonly string[]
  run(): void
}

/**
 * "Show link as link / inline / compact / card" for the link at the cursor: one
 * entry for each display it could be changed to. None when the cursor is in no
 * link, and none for the display it already has or one that cannot go where it
 * is (a card in a heading).
 */
export function linkDisplayPaletteCommands(editor: Editor): readonly EditorPaletteCommand[] {
  const { state } = editor
  if (linkTargetAt(state) === null) return []
  return LINK_DISPLAY_GROUP.actions
    .filter((action) => action.command(state) && action.isChecked?.(state) !== true)
    .map((action) => ({
      id: `editor:${action.id}`,
      label: `Show link as ${action.label.toLowerCase()}`,
      keywords: ['link', 'preview', 'display', 'unfurl', action.label.toLowerCase()],
      run: () => {
        action.command(editor.state, editor.view.dispatch, editor.view)
        editor.view.focus()
      },
    }))
}
