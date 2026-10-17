import { AnchoredPopover, Button, Input } from '@quill/ui'
import type { Editor } from '@tiptap/react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import type { EditorView } from '@tiptap/pm/view'

import type { AltTextOverlay, OverlayStore } from '../context-menu/overlay-store.ts'
import { rangeBox } from '../link/open-link-popover.ts'

/**
 * Writing a picture's alternative text (the context menu's "Alt text"): what
 * a screen reader says in its place, and what shows when it cannot load. One
 * field, saved as the image's `alt`, so `![alt](src)` changes and nothing
 * else; one undo step.
 */

export interface AltTextPopoverProps {
  readonly editor: Editor
  readonly overlay: AltTextOverlay
  readonly store: OverlayStore
}

export function AltTextPopover({ editor, overlay, store }: AltTextPopoverProps) {
  const image = editor.state.doc.nodeAt(overlay.pos)
  const current: unknown = image?.attrs['alt']
  const [alt, setAlt] = useState(typeof current === 'string' ? current : '')

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (image?.type.name === 'image') {
      editor.view.dispatch(editor.state.tr.setNodeAttribute(overlay.pos, 'alt', alt.trim()))
    }
    store.close()
  }

  return (
    <AnchoredPopover
      open
      anchor={overlay.anchor}
      label="Alternative text"
      onOpenChange={store.close}
      onCloseFocus={() => {
        editor.view.focus()
      }}
    >
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <Input
          label="Alternative text"
          description="What the picture shows, for someone who cannot see it"
          value={alt}
          onChange={(event) => {
            setAlt(event.target.value)
          }}
        />
        <Button type="submit" size="sm" className="self-end">
          Save
        </Button>
      </form>
    </AnchoredPopover>
  )
}

/** Opens the alternative-text field against the picture at `pos`. */
export function openAltText(view: EditorView, store: OverlayStore, pos: number): void {
  store.open({ kind: 'alt-text', anchor: rangeBox(view, pos, pos + 1), pos })
}
