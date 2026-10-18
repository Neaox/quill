import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * Words that stay drawn as selected while something beside the document has
 * the keyboard: the link popover's fields, which take focus from the editor.
 * A browser stops painting the selection of an editor that has lost focus, so
 * the writer would no longer see what they are linking; this draws it instead,
 * with the class find uses for the same reason (`selection-held`).
 *
 * The range is held in a plugin, mapped through any edit, and nothing is done
 * per transaction while nothing is held, so a keystroke pays nothing for it.
 */

interface Held {
  readonly from: number
  readonly to: number
}

function isHeld(value: unknown): value is Held {
  return (
    typeof value === 'object' &&
    value !== null &&
    'from' in value &&
    'to' in value &&
    typeof value.from === 'number' &&
    typeof value.to === 'number'
  )
}

const heldSelectionKey = new PluginKey<Held | null>('heldSelection')

/** Draws `range` as selected until it is let go (`null`); one transaction, not in the undo history. */
export function holdSelection(view: EditorView, range: Held | null): void {
  if (view.isDestroyed) return
  const current = heldSelectionKey.getState(view.state) ?? null
  if (current?.from === range?.from && current?.to === range?.to) return
  view.dispatch(view.state.tr.setMeta(heldSelectionKey, range).setMeta('addToHistory', false))
}

export const HeldSelection = Extension.create({
  name: 'heldSelection',
  addProseMirrorPlugins: () => [
    new Plugin<Held | null>({
      key: heldSelectionKey,
      state: {
        init: () => null,
        apply(tr, held) {
          const asked: unknown = tr.getMeta(heldSelectionKey)
          if (asked !== undefined) return isHeld(asked) && asked.from < asked.to ? asked : null
          if (held === null || !tr.docChanged) return held
          const from = tr.mapping.map(held.from, 1)
          const to = tr.mapping.map(held.to, -1)
          return from < to ? { from, to } : null
        },
      },
      props: {
        decorations(state) {
          const held = heldSelectionKey.getState(state) ?? null
          if (held === null) return null
          return DecorationSet.create(state.doc, [
            Decoration.inline(held.from, held.to, { class: 'selection-held' }),
          ])
        },
      },
    }),
  ],
})
