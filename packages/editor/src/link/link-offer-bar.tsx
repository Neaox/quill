import { TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { tv } from 'tailwind-variants'

import { useLinkPreviewSource } from '../blocks/link-preview-context.tsx'
import type { LinkAction } from './link-display-actions.ts'
import { LinkDisplayButtons } from './link-display-controls.tsx'
import { linkOfferAt } from './link-offer.ts'
import type { LinkOffer } from './link-offer.ts'

/**
 * The small offer that follows a pasted address: "Show as Link · Inline · Card"
 * (ADR-042, "Authoring surface").
 *
 * The link is already in the document; this only offers to show it another way.
 * It never takes focus and never blocks typing, and it is withdrawn by the
 * editor state it follows (`link-offer.ts`) the moment the author types, moves
 * away or presses Escape. Its buttons act on the link just pasted, which is why
 * the state they are drawn from has the caret inside it: the caret is at the end
 * of the link after a paste, and the display commands work on the link the caret
 * is in. While it is out, the link card steps aside for it.
 */

const bar = tv({
  slots: {
    root:
      'link-offer fixed z-40 flex max-w-[min(28rem,calc(100vw-1rem))] flex-wrap items-center gap-1 ' +
      'rounded-md border border-border-strong/70 bg-surface-raised p-1 text-xs shadow-raised',
    label: 'px-2 text-muted',
  },
})
const styles = bar()

export interface LinkOfferBarProps {
  readonly editor: Editor
}

function sameOffer(a: LinkOffer | null, b: LinkOffer | null): boolean {
  return a?.from === b?.from && a?.to === b?.to
}

export function LinkOfferBar({ editor }: LinkOfferBarProps) {
  const offer = useEditorState({
    editor,
    selector: ({ editor: current }) => (current.isEditable ? linkOfferAt(current.state) : null),
    equalityFn: sameOffer,
  })
  return offer === null ? null : <OfferSurface editor={editor} from={offer.from} to={offer.to} />
}

interface OfferSurfaceProps {
  readonly editor: Editor
  readonly from: number
  readonly to: number
}

/** The caret inside the link, which is where the display commands look. */
function caretInside(state: EditorState, from: number, to: number): TextSelection {
  return TextSelection.create(state.doc, Math.min(from + 1, to))
}

interface Watched {
  readonly state: EditorState
  readonly focused: boolean
}

function OfferSurface({ editor, from, to }: OfferSurfaceProps) {
  // Every new state, because what is on offer follows more than the document: an embed's
  // frame becomes known when its preview arrives.
  const watched = useEditorState({
    editor,
    selector: ({ editor: current }): Watched => ({
      state: current.state,
      focused: current.isFocused,
    }),
    equalityFn: (a, b) => b !== null && a.state === b.state && a.focused === b.focused,
  })
  const surface = useRef<HTMLDivElement | null>(null)
  const [focusWithin, setFocusWithin] = useState(false)
  const visible = watched.focused || focusWithin
  // The organisation's default is the choice to point at, not the one already made: the pasted
  // link is a plain link until the author picks.
  const { defaultDisplay } = useLinkPreviewSource()
  // The state the buttons are drawn from, and run against: the same document with the caret
  // inside the link.
  const inside = watched.state.apply(
    watched.state.tr.setSelection(caretInside(watched.state, from, to)),
  )

  // Follows focus into and out of the offer — DOM events, an external system.
  useEffect(() => {
    const element = surface.current
    /* v8 ignore next -- the element is mounted with the surface. */
    if (element === null) return undefined
    const enter = (): void => {
      setFocusWithin(true)
    }
    const leave = (event: FocusEvent): void => {
      if (!(event.relatedTarget instanceof Node) || !element.contains(event.relatedTarget)) {
        setFocusWithin(false)
      }
    }
    element.addEventListener('focusin', enter)
    element.addEventListener('focusout', leave)
    return () => {
      element.removeEventListener('focusin', enter)
      element.removeEventListener('focusout', leave)
    }
  }, [])

  // Hangs the offer under the link: layout the DOM owns.
  useLayoutEffect(() => {
    const element = surface.current
    if (!visible || element === null) return
    try {
      const start = editor.view.coordsAtPos(from)
      const end = editor.view.coordsAtPos(to)
      const left = Math.min(start.left, end.left)
      const room = globalThis.innerWidth - element.offsetWidth - 8
      element.style.top = `${String(Math.max(start.bottom, end.bottom) + 6)}px`
      element.style.left = `${String(Math.max(8, Math.min(left, room)))}px`
    } catch {
      // No layout to measure against: a test, or a view that has gone.
    }
  }, [editor, from, to, visible])

  const choose = (action: LinkAction): void => {
    editor.view.dispatch(editor.state.tr.setSelection(caretInside(editor.state, from, to)))
    action.command(editor.state, editor.view.dispatch, editor.view)
    editor.view.focus()
  }

  return createPortal(
    <div
      ref={surface}
      hidden={!visible}
      role="group"
      aria-label="Show pasted link as"
      className={styles.root()}
    >
      <span className={styles.label()}>Show as</span>
      <LinkDisplayButtons state={inside} onRun={choose} suggest={defaultDisplay} />
    </div>,
    document.body,
  )
}
