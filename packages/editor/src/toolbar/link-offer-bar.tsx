import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { useCallback, useRef } from 'react'

import { LINK_DISPLAY_GROUP } from '../actions/link-display-actions.ts'
import type { EditorAction } from '../actions/editor-action.ts'
import { useFloatingPlacement } from '../floating/use-floating-placement.ts'
import { linkOfferAt } from '../link/link-offer.ts'
import { useEditorFocus, useEditorSnapshot, useFocusWithin } from './hooks.ts'
import { ToolbarButton, ToolbarGroup, toolbarStyles } from './toolbar-controls.tsx'

/**
 * The small offer that follows a pasted address: "Show as Link · Inline · Card"
 * (ADR-042, "Authoring surface").
 *
 * The link is already in the document; this only offers to show it another way.
 * It never takes focus and never blocks typing, and it is withdrawn by the
 * editor state it follows (`link/link-offer.ts`) the moment the author types,
 * moves away or presses Escape. Its buttons act on the link just pasted, which
 * is why the state they are drawn from has the caret inside it: the caret is at
 * the end of the link after a paste, and the display commands work on the link
 * the caret is in.
 */

export interface LinkOfferBarProps {
  readonly editor: Editor
}

export function LinkOfferBar({ editor }: LinkOfferBarProps) {
  const state = useEditorSnapshot(editor)
  const offer = editor.isEditable ? linkOfferAt(state) : null
  return offer === null ? null : <OfferSurface editor={editor} from={offer.from} to={offer.to} />
}

interface OfferSurfaceProps {
  readonly editor: Editor
  readonly from: number
  readonly to: number
}

function OfferSurface({ editor, from, to }: OfferSurfaceProps) {
  const state = useEditorSnapshot(editor)
  const focused = useEditorFocus(editor)
  const surface = useRef<HTMLDivElement | null>(null)
  const focusWithin = useFocusWithin(surface)
  const visible = focused || focusWithin

  const locate = useCallback(() => {
    const start = editor.view.coordsAtPos(from)
    const end = editor.view.coordsAtPos(to)
    return {
      top: Math.min(start.top, end.top),
      bottom: Math.max(start.bottom, end.bottom),
      left: Math.min(start.left, end.left),
      right: Math.max(start.right, end.right),
    }
  }, [editor, from, to])
  useFloatingPlacement(surface, visible, locate, { prefer: 'below', align: 'start', gap: 6 })

  // The state the buttons are drawn from, and run against: the same document with
  // the caret inside the link, which is where the display commands look.
  const inside = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, Math.min(from + 1, to))),
  )

  if (!visible) return null

  const choose = (action: EditorAction): void => {
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, Math.min(from + 1, to))),
    )
    action.command(editor.state, editor.view.dispatch, editor.view)
    editor.view.focus()
  }

  return (
    <div
      ref={surface}
      role="group"
      aria-label="Show pasted link as"
      className={toolbarStyles().root()}
    >
      <span className="px-2 text-xs text-muted">Show as</span>
      <ToolbarGroup label="Show link as">
        {LINK_DISPLAY_GROUP.actions.map((action) => (
          <ToolbarButton key={action.id} action={action} state={inside} onRun={choose}>
            {action.label}
          </ToolbarButton>
        ))}
      </ToolbarGroup>
    </div>
  )
}
