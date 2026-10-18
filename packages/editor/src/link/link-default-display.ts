import { DEFAULT_LINK_DISPLAY } from '@quill/markdown'
import type { LinkDisplay } from '@quill/markdown'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'

/**
 * How a link whose author chose nothing is shown, which is the organisation's
 * decision and not the editor's (ADR-042, "Policy").
 *
 * A link written as a directive with no `display` is drawn the way the reader
 * will draw it, so the editor has to know what that is. The application knows
 * (`LinkPreviewSource.defaultDisplay`) and hands it to the editor as a meta on a
 * transaction, which keeps it in the editor's own state: the commands that ask
 * "what is this link shown as?" are functions of the state alone, so they can
 * answer without a prop reaching them.
 */

const key = new PluginKey<LinkDisplay>('linkDefaultDisplay')

/** What an unchosen link is shown as now: the organisation's choice, or the product's default until it is known. */
export function linkDefaultDisplayOf(state: EditorState): LinkDisplay {
  return key.getState(state) ?? DEFAULT_LINK_DISPLAY
}

/** Tells the editor what the organisation's default display is. Not part of the document, and not undoable. */
export function withLinkDefaultDisplay(tr: Transaction, display: LinkDisplay): Transaction {
  return tr.setMeta(key, display).setMeta('addToHistory', false)
}

function isDisplay(value: unknown): value is LinkDisplay {
  return typeof value === 'string'
}

/** The plugin that holds the display, for an editor state built without the extension list. */
export function linkDefaultDisplayPlugin(): Plugin<LinkDisplay> {
  return new Plugin<LinkDisplay>({
    key,
    state: {
      init: () => DEFAULT_LINK_DISPLAY,
      apply: (transaction, current) => {
        const meta: unknown = transaction.getMeta(key)
        return isDisplay(meta) ? meta : current
      },
    },
  })
}

export const LinkDefaultDisplayExtension = Extension.create({
  name: 'linkDefaultDisplay',
  addProseMirrorPlugins: () => [linkDefaultDisplayPlugin()],
})
