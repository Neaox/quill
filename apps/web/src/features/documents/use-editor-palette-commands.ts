import { useEffect } from 'react'
import type { RefObject } from 'react'

import { linkDisplayPaletteCommands } from '@quill/editor'
import type { DocumentEditorHandle } from '@quill/editor'

import { registerEditorCommands } from '../search/editor-commands.ts'

/**
 * Offers the command palette what this editor can do at the cursor (ADR-042):
 * for now, "Show link as …" for the link the cursor is in.
 *
 * The palette asks when it opens, so the list is true to the cursor then; this
 * only registers the question while the editor is on screen. That is an effect
 * because it synchronises with something outside React (the palette's list of
 * sources), and it undoes itself when the editor goes.
 */
export function useEditorPaletteCommands(editorRef: RefObject<DocumentEditorHandle | null>): void {
  useEffect(
    () =>
      registerEditorCommands(() => {
        const editor = editorRef.current?.editor
        return editor === null || editor === undefined ? [] : linkDisplayPaletteCommands(editor)
      }),
    [editorRef],
  )
}
