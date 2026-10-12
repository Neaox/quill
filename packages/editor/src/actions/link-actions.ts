import { isExternal } from '../format/href.ts'
import { linkAt, unlink } from '../format/links.ts'
import type { ActionGroup, EditorAction } from './editor-action.ts'

/**
 * What the author can do about a link, and about making one.
 *
 * Editing an address is a conversation with the author, not a document change,
 * so it is the one action here that needs the interface: `edit` is told to open
 * the link box and does nothing else. Opening and copying a link reach outside
 * the document, and are written as commands that act only when they are
 * dispatched, so asking whether they are available never opens a tab.
 */

export interface LinkUi {
  /** Opens the box an address is typed into. */
  edit(): void
}

export interface LinkActions {
  readonly edit: EditorAction
  readonly open: EditorAction
  readonly copy: EditorAction
  readonly remove: EditorAction
}

export function linkActions(ui: LinkUi): LinkActions {
  return {
    edit: {
      id: 'link-edit',
      label: 'Link…',
      keys: 'Mod-k',
      command: (state, dispatch) => {
        if (state.selection.empty && linkAt(state) === null) return false
        if (dispatch !== undefined) ui.edit()
        return true
      },
    },
    open: {
      id: 'link-open',
      label: 'Open link',
      command: (state, dispatch) => {
        const link = linkAt(state)
        if (link === null) return false
        if (dispatch !== undefined) {
          const target = isExternal(link.href) ? '_blank' : '_self'
          window.open(link.href, target, 'noopener,noreferrer')
        }
        return true
      },
    },
    copy: {
      id: 'link-copy',
      label: 'Copy link address',
      command: (state, dispatch) => {
        const link = linkAt(state)
        if (link === null) return false
        if (dispatch !== undefined) void navigator.clipboard.writeText(link.href)
        return true
      },
    },
    remove: { id: 'link-remove', label: 'Remove link', destructive: true, command: unlink },
  }
}

export function linkGroup(ui: LinkUi): ActionGroup {
  const { edit, open, copy, remove } = linkActions(ui)
  return { id: 'link', label: 'Link', actions: [edit, open, copy, remove] }
}
