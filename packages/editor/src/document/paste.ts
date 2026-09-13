import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'

import { insertMarkdown, setLink } from './commands.ts'

/**
 * What the editor does with the clipboard.
 *
 * Two behaviours writers expect and one rule that keeps them out of the way:
 * plain text is read as Markdown, a URL pasted over a selection turns it into a
 * link, and anything else is left to ProseMirror. The decision is a pure
 * function of the clipboard and the selection, so every case is a table test
 * rather than a simulated paste.
 */

/** A bare absolute web address and nothing else, which is what a paste of a link is. */
const URL_ONLY = /^https?:\/\/\S+$/

export type PasteAction =
  | { readonly kind: 'default' }
  | { readonly kind: 'link'; readonly href: string }
  | { readonly kind: 'markdown'; readonly text: string }

export interface PasteInput {
  readonly text: string
  /** Rich clipboard content, which ProseMirror already knows how to read. */
  readonly html: string
  /** Inside a code block or another code node, text is text and nothing else. */
  readonly inCode: boolean
  readonly hasSelection: boolean
}

export function choosePaste(input: PasteInput): PasteAction {
  const text = input.text.trim()
  if (input.inCode || text.length === 0) return { kind: 'default' }
  if (input.hasSelection && URL_ONLY.test(text)) return { kind: 'link', href: text }
  if (input.html.length > 0) return { kind: 'default' }
  return { kind: 'markdown', text: input.text }
}

function inputFrom(state: EditorState, event: ClipboardEvent): PasteInput {
  const data = event.clipboardData
  return {
    text: data?.getData('text/plain') ?? '',
    html: data?.getData('text/html') ?? '',
    inCode: state.selection.$from.parent.type.spec.code === true,
    hasSelection: !state.selection.empty,
  }
}

export const pasteKey = new PluginKey('editorPaste')

export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',
  addProseMirrorPlugins: () => [
    new Plugin({
      key: pasteKey,
      props: {
        handlePaste: (view, event) => {
          const action = choosePaste(inputFrom(view.state, event))
          if (action.kind === 'default') return false
          const command =
            action.kind === 'link' ? setLink(action.href) : insertMarkdown(action.text)
          return command(view.state, view.dispatch, view)
        },
      },
    }),
  ],
})
