import { toast } from '@quill/ui'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Command, EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { CellSelection } from 'prosemirror-tables'

import {
  canReadClipboard,
  readClipboard,
  selectionPayload,
  writeClipboard,
} from '../clipboard/clipboard.ts'
import { tableContext } from '../table/table-context.ts'
import { markdownOfTable, tableOfSlice } from '../table/table-copy.ts'
import { handleGridPaste } from '../table/table-paste.ts'
import type { ActionGroup, EditorAction } from './editor-action.ts'

/**
 * Cut, Copy and Paste, for the menu that has no keyboard event to ride on.
 *
 * Each does what the keyboard's does (the editor's own serialiser for a copy, its
 * own paste handling for a paste, so a spreadsheet's cells still land as a table),
 * but reaches the clipboard as a page may, which is asynchronously and by leave of
 * the browser. They are commands like any other: asked without a dispatch they only
 * say whether they could act, and the work they start is told, in a toast, when
 * the browser says no — with the keyboard as the way that always works.
 */

const REFUSED =
  'The browser would not let the editor use the clipboard. Use the keyboard shortcut instead.'

async function copySelection(view: EditorView): Promise<boolean> {
  const payload = selectionPayload(view)
  const copied = payload !== undefined && (await writeClipboard(payload))
  if (!copied) toast.warning(REFUSED)
  return copied
}

const copy: Command = (state, dispatch, view) => {
  if (state.selection.empty) return false
  if (dispatch !== undefined && view !== undefined) void copySelection(view)
  return true
}

const cut: Command = (state, dispatch, view) => {
  if (state.selection.empty) return false
  if (dispatch === undefined || view === undefined) return true
  const { selection } = state
  void copySelection(view).then((copied) => {
    // What was copied is what goes, and only if the author has not moved on since.
    if (copied && view.state.selection.eq(selection)) {
      view.dispatch(view.state.tr.deleteSelection().scrollIntoView())
    }
  })
  return true
}

async function pasteFromClipboard(view: EditorView): Promise<void> {
  const clip = await readClipboard()
  if (clip === undefined) {
    toast.warning(REFUSED)
    return
  }
  if (clip.html === '' && clip.text === '') return
  const data = { getData: (type: string) => (type === 'text/html' ? clip.html : clip.text) }
  // A spreadsheet's cells become a table, as they do from the keyboard.
  if (handleGridPaste(view.state, data, view.dispatch, view.dom.ownerDocument)) return
  if (clip.html === '') view.pasteText(clip.text)
  else view.pasteHTML(clip.html)
}

const paste: Command = (_state, dispatch, view) => {
  if (!canReadClipboard()) return false
  if (dispatch !== undefined && view !== undefined) void pasteFromClipboard(view)
  return true
}

export const CUT: EditorAction = { id: 'cut', label: 'Cut', keys: 'Mod-x', command: cut }
export const COPY: EditorAction = { id: 'copy', label: 'Copy', keys: 'Mod-c', command: copy }
export const PASTE: EditorAction = { id: 'paste', label: 'Paste', keys: 'Mod-v', command: paste }

export const CLIPBOARD_GROUP: ActionGroup = {
  id: 'clipboard',
  label: 'Clipboard',
  actions: [CUT, COPY, PASTE],
}

/** The table a "Copy as Markdown" is about: the selected cells, else the whole table the caret is in. */
function tableToCopy(state: EditorState): PMNode | undefined {
  const { selection } = state
  if (selection instanceof CellSelection) return tableOfSlice(selection.content())
  return tableContext(state)?.table
}

/** Writes a table's Markdown, telling the author when the browser would not. */
function copyMarkdown(table: PMNode): void {
  void writeClipboard({ html: '', text: markdownOfTable(table) }).then((copied) => {
    if (!copied) toast.warning(REFUSED)
  })
}

/** A command that copies the table `which` finds in the state as Markdown. */
function copyingMarkdownOf(which: (state: EditorState) => PMNode | undefined): Command {
  return (state, dispatch, view) => {
    const table = which(state)
    if (table === undefined) return false
    if (dispatch !== undefined && view !== undefined) copyMarkdown(table)
    return true
  }
}

export const COPY_AS_MARKDOWN: EditorAction = {
  id: 'copy-markdown',
  label: 'Copy as Markdown',
  command: copyingMarkdownOf(tableToCopy),
}

/** The whole table, whatever of it is selected. */
export const COPY_TABLE_AS_MARKDOWN: EditorAction = {
  id: 'copy-table-markdown',
  label: 'Copy table as Markdown',
  command: copyingMarkdownOf((state) => tableContext(state)?.table),
}
