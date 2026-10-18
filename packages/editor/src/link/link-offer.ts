import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Command, EditorState } from '@tiptap/pm/state'

import { markType } from '../schema/node-type.ts'

/**
 * The offer that follows a pasted address (ADR-042, "Authoring surface").
 *
 * Pasting an address inserts the plain link at once, and an offer to show it
 * another way appears beside it. The offer is a small piece of editor state, the
 * range of the link just pasted, and nothing more: it is not a modal and it holds
 * no focus. It is withdrawn by anything that says the author has moved on: typing
 * or any other edit, the caret leaving the link, or Escape. Undo after a change of
 * display returns the plain link, because the change is one ordinary edit.
 */

export interface LinkOffer {
  readonly from: number
  readonly to: number
}

export const linkOfferKey = new PluginKey<LinkOffer | null>('linkOffer')

/** The offer standing now, or null. */
export function linkOfferAt(state: EditorState): LinkOffer | null {
  return linkOfferKey.getState(state) ?? null
}

type OfferMeta =
  | { readonly kind: 'offer'; readonly offer: LinkOffer }
  | { readonly kind: 'withdraw' }

function isOfferMeta(value: unknown): value is OfferMeta {
  return typeof value === 'object' && value !== null && 'kind' in value
}

/**
 * Puts a link to `href` at the caret, its words the address, and offers to show
 * it another way. A paste over a selection links the selection instead and is not
 * this.
 */
export function pasteAddress(href: string): Command {
  return (state, dispatch) => {
    const mark = markType(state.schema, 'link').create({ href, title: null })
    if (dispatch !== undefined) {
      const from = state.selection.from
      const tr = state.tr.replaceSelectionWith(state.schema.text(href, [mark]), false)
      dispatch(
        tr
          .setMeta(linkOfferKey, { kind: 'offer', offer: { from, to: from + href.length } })
          .setMeta('uiEvent', 'paste')
          .scrollIntoView(),
      )
    }
    return true
  }
}

/** Withdraws the offer, as Escape does. */
export const withdrawLinkOffer: Command = (state, dispatch) => {
  if (linkOfferAt(state) === null) return false
  dispatch?.(state.tr.setMeta(linkOfferKey, { kind: 'withdraw' }))
  return true
}

export const LinkOfferExtension = Extension.create({
  name: 'linkOffer',
  addProseMirrorPlugins() {
    return [
      new Plugin<LinkOffer | null>({
        key: linkOfferKey,
        state: {
          init: () => null,
          apply: (transaction, offer, _old, state) => {
            const meta: unknown = transaction.getMeta(linkOfferKey)
            if (isOfferMeta(meta)) return meta.kind === 'offer' ? meta.offer : null
            if (offer === null || transaction.docChanged) return null
            const { from, to } = state.selection
            return from >= offer.from && to <= offer.to ? offer : null
          },
        },
        props: {
          handleKeyDown: (view, event) =>
            event.key === 'Escape' && withdrawLinkOffer(view.state, view.dispatch),
        },
      }),
    ]
  },
})
