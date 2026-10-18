import type { EditorView as CodeMirrorView } from '@codemirror/view'
import type { CopySource } from '@quill/design-css/copy'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'

import { createSlashRecents } from '../slash/slash-recents.ts'
import type { SlashRecents } from '../slash/slash-recents.ts'
import { LanguagePicker } from './language-picker.tsx'

/**
 * What a code block and a code group's tab share in the editor: the picker a
 * language is chosen in, and what the copy button copies from a CodeMirror
 * editor. One implementation, used by the block's own toolbar and by a
 * group's tab strip (ADR-041).
 */

export { languageName, PLAIN_TEXT } from './language-options.ts'

/** Where the languages a person chose last are remembered in their browser. */
export const RECENT_LANGUAGES_KEY = 'editor.code.recent-languages'

/** Before the block has said what its language is. */
const NOT_SHOWN = Symbol('not shown')

let pageRecents: SlashRecents | undefined

/** The page's recently used languages, shared by every block on it. */
function recentLanguages(): SlashRecents {
  pageRecents ??= createSlashRecents(RECENT_LANGUAGES_KEY)
  return pageRecents
}

export interface LanguageField {
  /** The picker's host, for the node view to place in its toolbar. */
  readonly element: HTMLElement
  /** Shows a block's language, as its name. */
  show(language: unknown): void
  /**
   * Allows a deferred field to be drawn; drawn at once if it has been shown
   * a language, else with the first one it is shown.
   */
  draw(): void
  /** Takes the picker down with the node view. */
  destroy(): void
}

export interface LanguageFieldOptions {
  /**
   * Draws nothing until `draw` is called. A long document holds hundreds of
   * code blocks, and a picker is a React root apiece: the ones far from the
   * screen are not worth building as the document lands (quill-plan.md
   * section 31).
   */
  readonly deferred?: boolean
  /** Told the fence name chosen; false when nothing changed, so the field shows the block again. */
  commit(name: string | null): boolean
  /** Escape: the field shows the block's language again, and the keyboard goes back to the code. */
  cancel(): void
}

/**
 * The language picker (`language-picker.tsx`), mounted into a ProseMirror node
 * view, which is plain DOM: a React root of its own, drawn again only when the
 * block's language changes rather than on every keystroke in the code.
 */
export function createLanguageField(options: LanguageFieldOptions): LanguageField {
  const element = document.createElement('div')
  element.className = 'contents'
  const root = createRoot(element)
  let shown: unknown = NOT_SHOWN
  let drawnFor: unknown = NOT_SHOWN
  let allowed = options.deferred !== true
  let destroyed = false
  const paintPicker = (): void => {
    if (destroyed || !allowed || shown === NOT_SHOWN || shown === drawnFor) return
    drawnFor = shown
    root.render(
      createElement(LanguagePicker, {
        language: shown,
        onChoose: (name) => options.commit(name),
        onDismiss: () => {
          options.cancel()
        },
        recent: recentLanguages(),
      }),
    )
  }
  const show = (language: unknown): void => {
    shown = language
    paintPicker()
  }
  return {
    element,
    show,
    draw: () => {
      allowed = true
      paintPicker()
    },
    destroy: () => {
      destroyed = true
      // A node view is destroyed while ProseMirror, and so React, may be
      // mid-update; the root goes once that has finished.
      queueMicrotask(() => {
        root.unmount()
      })
    },
  }
}

/**
 * What the copy button copies from a CodeMirror editor: the selection made
 * in the code, if there is one, else the whole block — the block's own text,
 * never the line-number gutter beside it. Where the clipboard is refused, the
 * same text is selected in the editor so the keyboard can copy it.
 */
export function codeMirrorSource(editor: () => CodeMirrorView | null): CopySource {
  return {
    read: () => {
      const state = editor()?.state
      if (state === undefined) return { text: '', mode: 'code' }
      const { main } = state.selection
      return main.empty
        ? { text: state.doc.toString(), mode: 'code' }
        : { text: state.sliceDoc(main.from, main.to), mode: 'selection' }
    },
    select: () => {
      const view = editor()
      if (view === null) return
      const { state } = view
      if (state.selection.main.empty) {
        view.dispatch({ selection: { anchor: 0, head: state.doc.length } })
      }
      view.focus()
    },
  }
}
