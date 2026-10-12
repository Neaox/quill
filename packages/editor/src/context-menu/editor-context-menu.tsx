import { Selection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { useCallback, useEffect, useState } from 'react'

import { contextMenuGroups } from '../actions/context-groups.ts'
import type { CommentRequest } from '../block/comment-request.ts'
import { pointRect } from '../floating/placement.ts'
import { ActionMenu } from '../menu/action-menu.tsx'
import type { CloseReason } from '../menu/action-menu.tsx'
import { useEditorSnapshot, useRunAction } from '../toolbar/hooks.ts'
import type { LinkEditing } from '../toolbar/hooks.ts'

/**
 * The right-click menu of the writing surface.
 *
 * What it offers depends on where the author pointed (`contextMenuGroups`), so
 * the same gesture gives table tools in a table, variants in a callout, and link
 * tools on a link. Three conventions keep it from being in the way:
 *
 * - Shift + right-click opens the browser's own menu, which is where spelling
 *   suggestions, "Search the web" and the clipboard live, and which this menu
 *   does not try to replace.
 * - A right-click outside the selection moves the caret there first, as the
 *   browser's menu would, so the menu always acts on what was clicked.
 * - The keyboard's Menu key and Shift+F10 raise the same event, with no pointer
 *   position; the menu then opens at the caret.
 */

interface Point {
  readonly x: number
  readonly y: number
}

export interface EditorContextMenuProps {
  readonly editor: Editor
  readonly linkEditing: LinkEditing
  readonly onComment?: ((request: CommentRequest) => void) | undefined
}

/** A context menu raised from the keyboard has no pointer, and reports it at the origin. */
function isFromKeyboard(event: MouseEvent): boolean {
  return event.clientX === 0 && event.clientY === 0
}

/**
 * Moves the caret to where was clicked, unless that is inside what is already
 * selected. What is selected is its ranges, not the span from its first end to
 * its last: cells selected down a column have the whole next column between them,
 * and a click there is outside the selection.
 */
function selectUnderPointer(editor: Editor, point: Point): void {
  const { view, state } = editor
  const hit = view.posAtCoords({ left: point.x, top: point.y })
  if (hit === null) return
  const { selection } = state
  const inside = selection.ranges.some(
    (range) => hit.pos >= range.$from.pos && hit.pos <= range.$to.pos,
  )
  if (!selection.empty && inside) return
  view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(hit.pos))))
}

function caretPoint(editor: Editor): Point {
  const { left, bottom } = editor.view.coordsAtPos(editor.state.selection.from)
  return { x: left, y: bottom }
}

export function EditorContextMenu({ editor, linkEditing, onComment }: EditorContextMenuProps) {
  const [point, setPoint] = useState<Point | null>(null)

  // Listens for the document's own contextmenu event, which React does not
  // render: the browser raises it on the editor's DOM, not on anything in the tree.
  useEffect(() => {
    const dom = editor.view.dom
    const open = (event: MouseEvent): void => {
      if (event.shiftKey || !editor.isEditable) return
      event.preventDefault()
      if (isFromKeyboard(event)) {
        setPoint(caretPoint(editor))
        return
      }
      const where = { x: event.clientX, y: event.clientY }
      // A table's handles select what they stand for themselves, and stand outside the
      // text, so where they are is not a place to put a caret.
      if (!(event.target instanceof Element && event.target.closest('.table-handles'))) {
        selectUnderPointer(editor, where)
      }
      setPoint(where)
    }
    dom.addEventListener('contextmenu', open)
    return () => {
      dom.removeEventListener('contextmenu', open)
    }
  }, [editor])

  const close = useCallback(
    (reason: CloseReason) => {
      setPoint(null)
      if (reason === 'escape') editor.view.focus()
    },
    [editor],
  )

  return point === null ? null : (
    <OpenContextMenu
      editor={editor}
      point={point}
      linkEditing={linkEditing}
      onComment={onComment}
      onClose={close}
    />
  )
}

interface OpenContextMenuProps extends EditorContextMenuProps {
  readonly point: Point
  onClose(reason: CloseReason): void
}

/** The menu at a point, for as long as it is open. */
function OpenContextMenu({ editor, point, linkEditing, onComment, onClose }: OpenContextMenuProps) {
  const state = useEditorSnapshot(editor)
  const run = useRunAction(editor)
  const locate = useCallback(() => pointRect(point.x, point.y), [point])
  const groups = contextMenuGroups(state, {
    edit: () => {
      linkEditing.open()
    },
    onComment,
  })

  return (
    <ActionMenu
      label="Context menu"
      groups={groups}
      state={state}
      locate={locate}
      onChoose={run}
      onClose={onClose}
    />
  )
}
