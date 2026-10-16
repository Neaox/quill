import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import type { EditorState } from '@tiptap/pm/state'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RefObject } from 'react'

import type { EditorAction } from '../actions/editor-action.ts'
import { targetKey, toolbarTarget } from './toolbar-target.ts'

/**
 * The small hooks the editor's floating surfaces share.
 *
 * Each one is a seam between React and something React does not own — the
 * editor's state, the browser's focus — kept here so the components stay a
 * description of what is drawn.
 */

/**
 * The editor's current state, re-read after every transaction. Compared by
 * identity: a ProseMirror state is replaced, never mutated, so identity is
 * exactly "did anything change", and a deep comparison would walk the document.
 */
export function useEditorSnapshot(editor: Editor): EditorState {
  return useEditorState({
    editor,
    selector: ({ editor: current }) => current.state,
    equalityFn: Object.is,
  })
}

/** Whether the editor has the keyboard focus, which the toolbar follows. */
export function useEditorFocus(editor: Editor): boolean {
  return useEditorState({
    editor,
    selector: ({ editor: current }) => current.isFocused,
  })
}

/**
 * Runs an action against the editor, then returns focus to the document so the
 * author carries on typing where they were.
 */
export function useRunAction(editor: Editor): (action: EditorAction) => void {
  return useCallback(
    (action) => {
      action.command(editor.state, editor.view.dispatch, editor.view)
      editor.view.focus()
    },
    [editor],
  )
}

/**
 * Whether focus is inside an element. It listens to the document's `focusin`
 * rather than to the element's own events, because an element that is removed
 * while it holds focus never says it lost it.
 */
export function useFocusWithin(element: RefObject<HTMLElement | null>): boolean {
  const [within, setWithin] = useState(false)
  // Subscribes to the browser's focus changes, which happen outside React.
  useEffect(() => {
    const track = (event: FocusEvent): void => {
      setWithin(event.target instanceof Node && element.current?.contains(event.target) === true)
    }
    document.addEventListener('focusin', track)
    return () => {
      document.removeEventListener('focusin', track)
    }
  }, [element])
  return within
}

export interface LinkEditing {
  /** Whether the link box is open for the toolbar with this key. */
  isOpenFor(key: string): boolean
  /** Opens the link box for whatever the toolbar is about now; false if it is about no link. */
  open(): boolean
  close(): void
}

/**
 * The link box's open state, tied to the toolbar it opened for.
 *
 * It remembers *which toolbar* it is open for, by key, instead of "open or
 * not": the moment the selection moves, the key no longer matches and the box
 * is closed, with nothing to reset and no effect to write. A box left open by a
 * stale `true` would otherwise reappear on the next selection.
 */
type Target = ReturnType<typeof toolbarTarget>

const editsAddress = (target: Target): boolean => target?.kind === 'text' || target?.kind === 'link'

const editsCard = (target: Target): boolean =>
  target?.kind === 'link' && target.form === 'leaf' && target.display === 'card'

export function useLinkEditing(editor: Editor): LinkEditing {
  return useToolbarBox(editor, editsAddress)
}

/**
 * The preview-details box's open state (ADR-042): open only for a link shown as a
 * card, tied to the toolbar it opened for in the same way the link box is.
 */
export function useDetailsEditing(editor: Editor): LinkEditing {
  return useToolbarBox(editor, editsCard)
}

function useToolbarBox(editor: Editor, accepts: (target: Target) => boolean): LinkEditing {
  const [openFor, setOpenFor] = useState<string | null>(null)
  const open = useCallback(() => {
    const target = toolbarTarget(editor.state)
    const editable = accepts(target)
    setOpenFor(editable ? targetKey(target) : null)
    return editable
  }, [editor, accepts])
  const close = useCallback(() => {
    setOpenFor(null)
  }, [])
  return useMemo(
    () => ({ isOpenFor: (key) => openFor === key, open, close }),
    [openFor, open, close],
  )
}
