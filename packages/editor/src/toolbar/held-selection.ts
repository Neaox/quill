import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * A selection that stays in view while something else has the keyboard.
 *
 * Select text and press Link, and the box the address is typed into takes the
 * focus. A browser stops drawing the selection of a field that has lost it, so
 * the words the link is for would vanish at the moment the author is about to
 * say what they link to. The selection is still there, as the editor's state;
 * what is gone is the paint. So while the box is open the range is drawn as
 * a decoration in the colour a selection is, the way every editor with a link box
 * keeps it, and is let go of when the box closes and the document has the focus back.
 */

export interface HeldRange {
  readonly from: number
  readonly to: number
}

export interface HeldSelection {
  readonly range: HeldRange | null
  readonly decorations: DecorationSet
}

export const heldSelectionKey = new PluginKey<HeldSelection>('heldSelection')

/** Holds the range, drawn as selected, from this transaction on. */
export function holdSelectionMeta(tr: Transaction, range: HeldRange): Transaction {
  return tr.setMeta(heldSelectionKey, range)
}

/** Lets go of what was held. */
export function releaseSelectionMeta(tr: Transaction): Transaction {
  return tr.setMeta(heldSelectionKey, null)
}

function drawn(
  doc: Parameters<typeof DecorationSet.create>[0],
  range: HeldRange | null,
): DecorationSet {
  return range === null || range.from >= range.to
    ? DecorationSet.empty
    : DecorationSet.create(doc, [
        Decoration.inline(range.from, range.to, { class: 'selection-held' }),
      ])
}

export function createHeldSelectionPlugin(): Plugin<HeldSelection> {
  return new Plugin<HeldSelection>({
    key: heldSelectionKey,
    state: {
      init: () => ({ range: null, decorations: DecorationSet.empty }),
      apply: (tr, held) => {
        const meta: HeldRange | null | undefined = tr.getMeta(heldSelectionKey)
        if (meta !== undefined) return { range: meta, decorations: drawn(tr.doc, meta) }
        if (!tr.docChanged || held.range === null) return held
        const range = { from: tr.mapping.map(held.range.from), to: tr.mapping.map(held.range.to) }
        return { range, decorations: held.decorations.map(tr.mapping, tr.doc) }
      },
    },
    props: {
      decorations: (state) => heldSelectionKey.getState(state)?.decorations,
    },
  })
}

/** Gives the editor a held selection to draw. */
export const HeldSelectionExtension = Extension.create({
  name: 'heldSelection',
  addProseMirrorPlugins: () => [createHeldSelectionPlugin()],
})
