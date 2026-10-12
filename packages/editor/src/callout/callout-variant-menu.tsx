import { Selection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { useCallback, useEffect, useState } from 'react'

import { CALLOUT_VARIANT_GROUP } from '../actions/callout-actions.ts'
import { ActionMenu } from '../menu/action-menu.tsx'
import type { CloseReason } from '../menu/action-menu.tsx'
import { useEditorSnapshot, useRunAction } from '../toolbar/hooks.ts'

/**
 * Changing a callout's type from the callout itself.
 *
 * A callout says what kind it is in its heading, and the place to change that is
 * the heading: a click on the type's name, or on the icon beside a title of the
 * author's own, opens the list of types where it is. It is a convenience for the
 * pointer, over what the toolbar and the context menu already offer, which is why
 * what it points at is hidden from assistive technology and out of the tab order:
 * the keyboard has those two, and a second way in would be a third control that
 * says the same thing.
 *
 * It listens for the document's own clicks, which React does not render, and
 * leaves the words of a title to be clicked into and typed in.
 */

/** Whether a click at `x` is on the icon that begins a heading drawn at `heading`, `width` wide. */
export function isOnIcon(heading: Pick<DOMRect, 'left'>, x: number, width: number): boolean {
  return x >= heading.left && x <= heading.left + width
}

interface Opened {
  /** The heading or the icon that was clicked, which the menu hangs from. */
  readonly anchor: Element
}

/** The part of a callout a click changes its type from, or null for any other click. */
function triggerOf(event: MouseEvent): Element | null {
  /* v8 ignore next -- a click's target is an element; the type says it may be a window or a document. */
  if (!(event.target instanceof Element)) return null
  const name = event.target.closest('.callout > .callout-label')
  if (name !== null) return name
  const title = event.target.closest('.callout > .directive-content > p[data-directive-label]')
  if (title === null || title.parentElement?.firstElementChild !== title) return null
  const width = Number.parseFloat(getComputedStyle(title, '::before').width)
  return isOnIcon(title.getBoundingClientRect(), event.clientX, width) ? title : null
}

export interface CalloutVariantMenuProps {
  readonly editor: Editor
}

export function CalloutVariantMenu({ editor }: CalloutVariantMenuProps) {
  const [opened, setOpened] = useState<Opened | null>(null)

  // Synchronises with the document's clicks, which the browser raises on the editor's DOM and
  // React does not render.
  useEffect(() => {
    const dom = editor.view.dom
    const click = (event: MouseEvent): void => {
      const anchor = editor.isEditable ? triggerOf(event) : null
      const callout = anchor?.closest('.callout')
      const content = callout?.querySelector(':scope > .directive-content')
      if (anchor === null || anchor === undefined || content === null || content === undefined)
        return
      // The caret goes into the callout, so what the menu changes is the callout it is on.
      const inside = editor.view.posAtDOM(content, 0)
      editor.view.dispatch(
        editor.state.tr.setSelection(Selection.near(editor.state.doc.resolve(inside), 1)),
      )
      setOpened({ anchor })
    }
    dom.addEventListener('click', click)
    return () => {
      dom.removeEventListener('click', click)
    }
  }, [editor])

  const close = useCallback(
    (reason: CloseReason) => {
      setOpened(null)
      if (reason === 'escape') editor.view.focus()
    },
    [editor],
  )

  return opened === null ? null : (
    <OpenVariantMenu editor={editor} anchor={opened.anchor} onClose={close} />
  )
}

interface OpenVariantMenuProps extends CalloutVariantMenuProps {
  readonly anchor: Element
  onClose(reason: CloseReason): void
}

function OpenVariantMenu({ editor, anchor, onClose }: OpenVariantMenuProps) {
  const state = useEditorSnapshot(editor)
  const run = useRunAction(editor)
  return (
    <ActionMenu
      label="Callout type"
      groups={[CALLOUT_VARIANT_GROUP]}
      state={state}
      locate={() => anchor.getBoundingClientRect()}
      onChoose={run}
      onClose={onClose}
    />
  )
}
