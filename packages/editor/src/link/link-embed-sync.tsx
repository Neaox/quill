import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import type { EditorState } from '@tiptap/pm/state'
import { useEffect } from 'react'

import { useLinkPreviewSource } from '../blocks/link-preview-context.tsx'
import { linkTargetAt } from './link-display.ts'
import { recordLinkEmbed } from './link-embeds.ts'
import { linkOfferAt } from './link-offer.ts'

/**
 * Tells the editor whether the link the author is on can be embedded (ADR-042).
 *
 * The `Embed` choice is a function of the editor state, and whether a page may
 * be embedded is a fact about its preview, which only the application holds. This
 * is the seam: it watches the one address the toolbar, the paste offer and the
 * context menu are about, makes sure the application has been asked for its
 * preview, and records the answer in the editor (`link-embeds.ts`). It draws
 * nothing, and it is not an edit: the answer never enters the document or the
 * undo history.
 */

/** The address the link controls are about now: the link under the caret, or the one just pasted. */
function wantedAddress(state: EditorState): string | null {
  const target = linkTargetAt(state)
  if (target !== null) return target.href
  const offer = linkOfferAt(state)
  // A pasted address is its own words, so its text is the address.
  return offer === null ? null : state.doc.textBetween(offer.from, offer.to)
}

export function LinkEmbedSync({ editor }: { readonly editor: Editor }) {
  const address = useEditorState({
    editor,
    selector: ({ editor: current }) => wantedAddress(current.state),
  })
  const source = useLinkPreviewSource()
  const { request } = source
  const embed = address === null ? null : (source.preview(address)?.embed ?? null)

  // Tells the application which page the link controls are about: it is the application that fetches.
  useEffect(() => {
    if (address !== null) request(address)
  }, [request, address])

  // Keeps the editor's record of what can be embedded in step with the application's previews.
  useEffect(() => {
    if (address === null || editor.isDestroyed) return
    const record = recordLinkEmbed(editor.state, address, embed)
    if (record !== null) editor.view.dispatch(record)
  }, [editor, address, embed])

  return null
}
