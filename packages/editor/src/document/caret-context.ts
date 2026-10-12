import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * Showing a keyboard user where they are inside a table, a callout or a block of notes.
 *
 * Focus in the editor is one thing, the whole writing surface, so `:focus-visible` can ring only
 * that and never the cell the caret is in: a table's cells and a callout's body are not focus
 * targets, they are places in one editable. The caret is a thin line, and in a grid of cells it does
 * not say which cell it is in. So the editor marks the place itself, with the class `has-caret` on
 * the nearest cell or container around the caret, and the style sheet draws it.
 *
 * It is drawn for the keyboard only, which is what `:focus-visible` does for a control. A pointer
 * shows where it is by being there, and a ring that follows a click is noise. Whichever of the two
 * was used last decides, and only a key that moves the caret counts as the keyboard.
 *
 * Observer over the selection, with the last input device as its one piece of state.
 */

/** The blocks a caret is "in" in a way the caret alone does not make clear. */
const CELLS: ReadonlySet<string> = new Set(['tableCell', 'tableHeader'])

const PLACES: ReadonlySet<string> = new Set([
  ...CELLS,
  'containerDirective',
  'details',
  'blockquote',
])

/**
 * The keys that move the caret. Writing is not on the list: someone who clicks into a callout and
 * types has not been navigating by keyboard, and a ring coming up as they write would say the
 * click had not been taken. Modifier keys on their own move nothing and are not on it either.
 */
const NAVIGATION_KEYS: ReadonlySet<string> = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Tab',
])

type Device = 'keyboard' | 'pointer'

/** Enter writes a new line anywhere but in a table's cell, where a cell is one line and it goes down one. */
function movesBetweenCells(event: KeyboardEvent, state: EditorState): boolean {
  if (event.key !== 'Enter') return false
  const { $from } = state.selection
  return Array.from({ length: $from.depth + 1 }, (_, depth) => $from.node(depth)).some((node) =>
    CELLS.has(node.type.name),
  )
}

const key = new PluginKey<Device>('caretContext')

/** The decoration for the innermost place around the selection, if there is one. */
function placeAround(state: EditorState): Decoration | undefined {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (PLACES.has(node.type.name)) {
      return Decoration.node($from.before(depth), $from.after(depth), { class: 'has-caret' })
    }
  }
  return undefined
}

export function createCaretContextPlugin(): Plugin<Device> {
  return new Plugin<Device>({
    key,
    state: {
      init: () => 'pointer',
      apply: (tr, device): Device => tr.getMeta(key) ?? device,
    },
    props: {
      handleDOMEvents: {
        keydown: (view, event) => {
          if (
            (NAVIGATION_KEYS.has(event.key) || movesBetweenCells(event, view.state)) &&
            key.getState(view.state) !== 'keyboard'
          ) {
            view.dispatch(view.state.tr.setMeta(key, 'keyboard'))
          }
          return false
        },
        pointerdown: (view) => {
          if (key.getState(view.state) !== 'pointer') {
            view.dispatch(view.state.tr.setMeta(key, 'pointer'))
          }
          return false
        },
      },
      decorations: (state) => {
        if (key.getState(state) !== 'keyboard') return null
        const place = placeAround(state)
        return place === undefined ? null : DecorationSet.create(state.doc, [place])
      },
    },
  })
}

/** Marks the cell or container the caret is in, while the keyboard is what is being used. */
export const CaretContext = Extension.create({
  name: 'caretContext',
  addProseMirrorPlugins: () => [createCaretContextPlugin()],
})
