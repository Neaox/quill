import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Command, Selection } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * Which details the author has closed while writing (ADR-048).
 *
 * Closing a details to get it out of the way is the view's business, not the
 * document's: it changes nothing a reader sees, is not a step of undo, and
 * leaves the details' own "Open by default" alone. It cannot live in the node
 * view either, which ProseMirror redraws when it chooses, so it lives here as
 * node decorations that map through every transaction. A fold carries
 * `data-folded` onto the details' element, which is what hides its body.
 *
 * A caret that arrives in a folded body — by the arrow keys, by Enter in the
 * summary, by undo — opens it again, so nothing the author is editing is ever
 * hidden from them.
 */

export const foldsKey = new PluginKey<DecorationSet>('detailsFolds')

/** Whether a details' decorations say it is folded. */
export function isFolded(decorations: readonly Decoration[]): boolean {
  return decorations.some((decoration) => decoration.spec['folded'] === true)
}

/** Folds the details at `pos`, or unfolds it. Nothing in the document changes. */
export function setFolded(pos: number, folded: boolean): Command {
  return (state, dispatch) => {
    if (state.doc.nodeAt(pos)?.type.name !== 'details') return false
    dispatch?.(state.tr.setMeta(foldsKey, { pos, folded }).setMeta('addToHistory', false))
    return true
  }
}

function fold(pos: number, node: PMNode): Decoration {
  return Decoration.node(pos, pos + node.nodeSize, { 'data-folded': '' }, { folded: true })
}

/** The folds whose body the selection reaches into: the ones that have to open. */
function holdingSelection(set: DecorationSet, selection: Selection): Decoration[] {
  const { doc } = selection.$from
  return set.find(selection.from, selection.to).filter((decoration) => {
    /* v8 ignore next -- a fold decorates a details, which always has its summary. */
    const summary = doc.nodeAt(decoration.from)?.firstChild?.nodeSize ?? 0
    const bodyStart = decoration.from + 1 + summary
    return selection.from < decoration.to && selection.to > bodyStart
  })
}

function isRequest(value: unknown): value is { readonly pos: number; readonly folded: boolean } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'pos' in value &&
    typeof value.pos === 'number' &&
    'folded' in value &&
    typeof value.folded === 'boolean'
  )
}

export const detailsFolds = new Plugin<DecorationSet>({
  key: foldsKey,
  state: {
    init: () => DecorationSet.empty,
    apply(transaction, set) {
      let next = set.map(transaction.mapping, transaction.doc)
      const request: unknown = transaction.getMeta(foldsKey)
      if (isRequest(request)) {
        const node = transaction.doc.nodeAt(request.pos)
        const own = next
          .find(request.pos, request.pos + 1)
          .filter((found) => found.from === request.pos)
        next = next.remove(own)
        if (request.folded && node !== null) {
          next = next.add(transaction.doc, [fold(request.pos, node)])
        }
      }
      const opened = holdingSelection(next, transaction.selection)
      return opened.length === 0 ? next : next.remove(opened)
    },
  },
  props: { decorations: (state) => foldsKey.getState(state) },
})
