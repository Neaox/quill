import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { SHORTCUTS } from '../format/shortcuts.ts'
import { linkAt } from '../link/link-commands.ts'
import type { OverlayAnchor, OverlayStore } from './overlay-store.ts'

/**
 * When the context menu opens (the plan's editor bar: Confluence and better).
 *
 * - A right-click inside the writing surface opens Quill's menu for what is
 *   under the pointer; everywhere else the browser's own menu is untouched.
 * - **Shift and right-click opens the browser's own menu**, inside the
 *   surface too, so its spelling suggestions, "Inspect" and an extension's
 *   entries are always one modifier away (`docs/extending/markdown-extensions.md`).
 * - Shift+F10 and the context-menu key open it at the caret, as they open the
 *   platform's menu everywhere else.
 * - A long press on a touch screen opens it as a sheet along the bottom.
 *
 * A right-click outside the selection moves the caret there first, as every
 * editor does, so the menu acts on what was pointed at; inside the selection
 * it keeps the selection, so "Bold" bolds what was selected.
 */

export interface ContextMenuTriggerOptions {
  readonly store: OverlayStore
  /** How long a finger rests before it is a long press. */
  readonly longPressMs?: number
}

/** How far a finger may drift and still be pressing, not scrolling. */
const TOLERANCE = 10
const LONG_PRESS_MS = 550

/** What the menu is about, which names it for assistive technology. */
export function placeLabel(state: EditorState, pos: number): string {
  const $pos = state.doc.resolve(pos)
  const after = $pos.nodeAfter
  if (after?.type.name === 'image') return 'Image'
  if (after?.type.name === 'codeBlock') return 'Code block'
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)
    const role = node.type.spec['tableRole']
    if (role === 'cell' || role === 'header_cell') return 'Table cell'
    if (node.type.name === 'codeBlock') return 'Code block'
  }
  if (linkAt(state, pos) !== undefined) return 'Link'
  return $pos.parent.isTextblock ? 'Text' : 'Block'
}

/**
 * Where in the document the pointer is. The coordinates say which character,
 * where they land inside the element the event came from; where they do not
 * — no layout to measure against, or a point the browser resolved elsewhere —
 * the element itself says, as the start of what it draws.
 */
function pointAt(
  view: EditorView,
  left: number,
  top: number,
  target: Node,
): { readonly pos: number; readonly inside: number } {
  // The document's own element starts before its first block.
  const from = Math.max(0, view.posAtDOM(target, 0))
  const to = view.posAtDOM(target, target.childNodes.length)
  const found = view.posAtCoords({ left, top })
  const at =
    found !== null && found.pos >= from && found.pos <= to ? found : { pos: from, inside: from }
  // Only a picture is selected as a whole; anywhere else the caret goes in the words.
  const picture = at.inside >= 0 && view.state.doc.nodeAt(at.inside)?.type.name === 'image'
  const inside = picture ? at.inside : -1
  return { pos: at.pos, inside }
}

/** The node an event came from, as the document's own element where it is not one of its. */
export function targetNode(view: EditorView, target: EventTarget | null): Node {
  return target instanceof Node && view.dom.contains(target) ? target : view.dom
}

/** Puts the selection where the pointer is, unless the pointer is inside it. */
function selectAt(view: EditorView, left: number, top: number, target: Node): number {
  const found = pointAt(view, left, top, target)
  const { state } = view
  const { from, to, empty } = state.selection
  if (!empty && found.pos >= from && found.pos <= to) return from
  if (found.inside >= 0) {
    view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, found.inside)))
    return found.inside
  }
  const near = TextSelection.near(state.doc.resolve(found.pos))
  view.dispatch(state.tr.setSelection(near))
  return near.from
}

export function openAt(
  view: EditorView,
  store: OverlayStore,
  anchor: OverlayAnchor,
  presentation: 'menu' | 'sheet',
  pos: number,
): void {
  store.open({
    kind: 'context-menu',
    anchor,
    presentation,
    pos,
    label: placeLabel(view.state, pos),
    returnFocus: () => {
      if (!view.isDestroyed) view.focus()
    },
  })
}

/** Opens the menu at the caret, for the keyboard. */
export function openAtCaret(view: EditorView, store: OverlayStore): boolean {
  const { head, from } = view.state.selection
  const box = view.coordsAtPos(head)
  const anchor: OverlayAnchor = { x: box.left, y: box.bottom, width: 0, height: 0 }
  openAt(view, store, anchor, 'menu', from)
  return true
}

function attach(view: EditorView, options: ContextMenuTriggerOptions): () => void {
  const { store } = options
  const delay = options.longPressMs ?? LONG_PRESS_MS
  let lastPointer = 'mouse'
  let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | undefined

  const cancelPress = (): void => {
    if (press !== undefined) clearTimeout(press.timer)
    press = undefined
  }

  const open = (
    x: number,
    y: number,
    presentation: 'menu' | 'sheet',
    target: EventTarget | null,
  ): void => {
    const pos = selectAt(view, x, y, targetNode(view, target))
    openAt(view, store, { x, y, width: 0, height: 0 }, presentation, pos)
  }

  const onContextMenu = (event: MouseEvent): void => {
    // The browser's own menu: spelling, "Inspect", extensions.
    if (event.shiftKey) return
    event.preventDefault()
    cancelPress()
    // Already open — from the keyboard, or a long press the browser also reported.
    if (store.getSnapshot().kind === 'context-menu') return
    open(event.clientX, event.clientY, lastPointer === 'touch' ? 'sheet' : 'menu', event.target)
  }

  const onPointerDown = (event: PointerEvent): void => {
    lastPointer = event.pointerType
    cancelPress()
    if (event.pointerType !== 'touch') return
    const { clientX: x, clientY: y, target } = event
    press = {
      x,
      y,
      timer: setTimeout(() => {
        press = undefined
        if (store.getSnapshot().kind !== 'context-menu') open(x, y, 'sheet', target)
      }, delay),
    }
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (press === undefined) return
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > TOLERANCE) cancelPress()
  }

  const dom = view.dom
  dom.addEventListener('contextmenu', onContextMenu)
  dom.addEventListener('pointerdown', onPointerDown)
  dom.addEventListener('pointermove', onPointerMove)
  dom.addEventListener('pointerup', cancelPress)
  dom.addEventListener('pointercancel', cancelPress)
  return () => {
    cancelPress()
    dom.removeEventListener('contextmenu', onContextMenu)
    dom.removeEventListener('pointerdown', onPointerDown)
    dom.removeEventListener('pointermove', onPointerMove)
    dom.removeEventListener('pointerup', cancelPress)
    dom.removeEventListener('pointercancel', cancelPress)
  }
}

export function contextMenuTrigger(options: ContextMenuTriggerOptions): Extension {
  return Extension.create({
    name: 'contextMenuTrigger',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          // A native listener rather than `handleDOMEvents`: a code block's
          // CodeMirror stops ProseMirror's handlers, and the menu belongs there too.
          view: (view) => ({ destroy: attach(view, options) }),
        }),
      ]
    },
    addKeyboardShortcuts() {
      const open = (): boolean => openAtCaret(this.editor.view, options.store)
      return { [SHORTCUTS.contextMenu]: open, [SHORTCUTS.contextMenuKey]: open }
    },
  })
}
