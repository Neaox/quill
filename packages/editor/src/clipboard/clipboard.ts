import type { EditorView } from '@tiptap/pm/view'

/**
 * The system clipboard, for the menu's Cut, Copy and Paste.
 *
 * Keyboard copy and paste go through the browser's own events, which the
 * editor already handles. A menu item has no such event, so it reaches the
 * clipboard the way a script may: asynchronously, and only where the browser
 * allows it. Everything here therefore says whether it worked rather than
 * assuming it did, and nothing throws: a browser that refuses is an answer.
 */

export interface ClipboardPayload {
  /** What a word processor or spreadsheet pastes as a table or as formatted text. */
  readonly html: string
  /** What anything else pastes. */
  readonly text: string
}

/**
 * What the editor's own copy would put on the clipboard for the selection, or
 * undefined when nothing is selected: the same serialiser, so a menu copy and
 * a keyboard copy are the same bytes, tab-separated cells and all.
 */
export function selectionPayload(view: EditorView): ClipboardPayload | undefined {
  const { selection } = view.state
  if (selection.empty) return undefined
  const { dom, text } = view.serializeForClipboard(selection.content())
  const holder = view.dom.ownerDocument.createElement('div')
  holder.append(dom)
  return { html: holder.innerHTML, text }
}

/** Whether this browser lets a page read the clipboard at all. */
export function canReadClipboard(): boolean {
  return 'clipboard' in navigator && typeof navigator.clipboard.readText === 'function'
}

/** Puts the payload on the clipboard; false when the browser would not let it. */
export async function writeClipboard(payload: ClipboardPayload): Promise<boolean> {
  try {
    if (payload.html !== '' && typeof ClipboardItem === 'function') {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([payload.html], { type: 'text/html' }),
          'text/plain': new Blob([payload.text], { type: 'text/plain' }),
        }),
      ])
    } else {
      await navigator.clipboard.writeText(payload.text)
    }
    return true
  } catch {
    return false
  }
}

/** What is on the clipboard, formatted if it is, or undefined when the browser would not say. */
export async function readClipboard(): Promise<ClipboardPayload | undefined> {
  try {
    if (typeof navigator.clipboard.read === 'function') {
      const [item] = await navigator.clipboard.read()
      if (item !== undefined) {
        const read = async (type: string): Promise<string> =>
          item.types.includes(type) ? (await item.getType(type)).text() : ''
        return { html: await read('text/html'), text: await read('text/plain') }
      }
    }
    return { html: '', text: await navigator.clipboard.readText() }
  } catch {
    return undefined
  }
}
