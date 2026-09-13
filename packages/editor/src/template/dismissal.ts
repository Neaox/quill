import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Command } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * Which guidance cards the author has waved away, for this session.
 *
 * Dismissal is not part of the document — the block is still there and is still
 * removed at publish (ADR-029) — but it cannot live in the node view either: a
 * node view is redrawn whenever ProseMirror decides to, and the card would come
 * straight back. It lives in plugin state as a decoration, which maps through
 * every transaction, so the card stays dismissed while the author keeps writing
 * around it.
 */

export const dismissalKey = new PluginKey<DecorationSet>('guidanceDismissal')

/** Whether this node's decorations say the author has dismissed it. */
export function isDismissed(decorations: readonly Decoration[]): boolean {
  return decorations.some((decoration) => decoration.spec['dismissed'] === true)
}

/** Waves away the card at this position. */
export function dismiss(pos: number): Command {
  return (state, dispatch) => {
    if (state.doc.nodeAt(pos) === null) return false
    dispatch?.(state.tr.setMeta(dismissalKey, pos))
    return true
  }
}

export const GuidanceDismissal = Extension.create({
  name: 'guidanceDismissal',
  addProseMirrorPlugins: () => [
    new Plugin<DecorationSet>({
      key: dismissalKey,
      state: {
        init: () => DecorationSet.empty,
        apply(transaction, set) {
          const mapped = set.map(transaction.mapping, transaction.doc)
          const pos: unknown = transaction.getMeta(dismissalKey)
          if (typeof pos !== 'number') return mapped
          const node = transaction.doc.nodeAt(pos)
          if (node === null) return mapped
          return mapped.add(transaction.doc, [
            Decoration.node(
              pos,
              pos + node.nodeSize,
              { 'data-dismissed': 'true' },
              { dismissed: true },
            ),
          ])
        },
      },
      props: { decorations: (state) => dismissalKey.getState(state) },
    }),
  ],
})
