import type { Editor } from '@tiptap/core'

/**
 * The facts about how the author is working that decide whether a floating
 * control should show: the selection toolbar and the link card.
 *
 * - **Typing.** A change to the document hides them until the selection is
 *   moved again; a toolbar over words being typed is in the way.
 * - **Dragging.** While the mouse is down the selection is still being made,
 *   so nothing appears until it is let go.
 * - **Focus.** Nothing floats over a document that does not have focus,
 *   unless focus is in the floating control itself.
 * - **Dismissed.** Escape puts them away until the selection moves.
 *
 * Kept outside React and read through `useSyncExternalStore`: the facts come
 * from ProseMirror's transactions and the DOM's pointer events, and a new
 * snapshot is made only when one of them changes, so a keystroke that changes
 * none of them renders nothing.
 */

export interface SelectionFacts {
  readonly typing: boolean
  readonly dragging: boolean
  readonly focused: boolean
  readonly dismissed: boolean
}

export interface SelectionWatch {
  subscribe(listener: () => void): () => void
  getSnapshot(): SelectionFacts
  /** Escape: hidden until the selection moves. */
  dismiss(): void
  /** Focus moved into a floating control, which counts as the editor's. */
  setInside(inside: boolean): void
}

export function createSelectionWatch(editor: Editor): SelectionWatch {
  const listeners = new Set<() => void>()
  let facts: SelectionFacts = {
    typing: false,
    dragging: false,
    focused: editor.isFocused,
    dismissed: false,
  }
  let inside = false
  let editorFocused = editor.isFocused

  const update = (next: Partial<SelectionFacts>): void => {
    const merged = { ...facts, ...next }
    if (
      merged.typing === facts.typing &&
      merged.dragging === facts.dragging &&
      merged.focused === facts.focused &&
      merged.dismissed === facts.dismissed
    ) {
      return
    }
    facts = merged
    for (const listener of listeners) listener()
  }

  const onTransaction = ({
    transaction,
  }: {
    transaction: { docChanged: boolean; selectionSet: boolean }
  }): void => {
    if (transaction.docChanged) update({ typing: true })
    else if (transaction.selectionSet) update({ typing: false, dismissed: false })
  }
  const onFocus = (): void => {
    editorFocused = true
    update({ focused: true })
  }
  const onBlur = (): void => {
    editorFocused = false
    update({ focused: inside })
  }
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button === 0) update({ dragging: true })
  }
  const onPointerUp = (): void => {
    update({ dragging: false })
  }

  // Listening starts with the first subscriber, once the view is mounted, and
  // stops with the last.
  let detach: (() => void) | undefined
  const attach = (): (() => void) => {
    editor.on('transaction', onTransaction)
    editor.on('focus', onFocus)
    editor.on('blur', onBlur)
    const dom = editor.view.dom
    dom.addEventListener('pointerdown', onPointerDown)
    globalThis.addEventListener('pointerup', onPointerUp)
    globalThis.addEventListener('pointercancel', onPointerUp)
    return () => {
      editor.off('transaction', onTransaction)
      editor.off('focus', onFocus)
      editor.off('blur', onBlur)
      dom.removeEventListener('pointerdown', onPointerDown)
      globalThis.removeEventListener('pointerup', onPointerUp)
      globalThis.removeEventListener('pointercancel', onPointerUp)
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      detach ??= attach()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          detach?.()
          detach = undefined
        }
      }
    },
    getSnapshot: () => facts,
    dismiss() {
      update({ dismissed: true })
    },
    setInside(value) {
      inside = value
      update({ focused: editorFocused || inside })
    },
  }
}
