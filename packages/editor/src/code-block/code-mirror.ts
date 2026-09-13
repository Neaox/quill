import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { Compartment, EditorState } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import type { Command as CodeMirrorCommand } from '@codemirror/view'

import { tokenHighlighting } from './highlight-style.ts'
import { loadGrammar } from './languages.ts'
import type { EditorLanguage } from './languages.ts'

/**
 * One CodeMirror editor, hosted inside one code block.
 *
 * The block's text lives in CodeMirror while the block is being written and in
 * the document AST the moment it is saved; this module owns only the first half
 * and hands every change to its caller. Keeping the two compartments — grammar
 * and editability — means changing a block's language or making the document
 * read-only reconfigures the editor instead of rebuilding it, so the caret and
 * the undo history survive.
 */

/** -1 leaves the block before it, 1 after it. */
export type EscapeDirection = -1 | 1

export interface CodeMirrorHost {
  readonly view: EditorView
  setText(text: string): void
  setLanguage(language: EditorLanguage | undefined): void
  setEditable(editable: boolean): void
  destroy(): void
}

export interface CodeMirrorOptions {
  readonly parent: HTMLElement
  readonly text: string
  readonly language: EditorLanguage | undefined
  readonly editable: boolean
  onChange(text: string): void
  onEscape(direction: EscapeDirection): void
}

/**
 * Whether the caret sits where the given key should leave the block rather than
 * move inside it. A selection is never at an edge: an arrow key collapses it.
 */
export function atEdge(state: EditorState, key: 'up' | 'down' | 'left' | 'right'): boolean {
  const { main } = state.selection
  if (!main.empty) return false
  const line = state.doc.lineAt(main.head)
  if (key === 'left') return main.head === 0
  if (key === 'right') return main.head === state.doc.length
  if (key === 'up') return line.number === 1
  return line.number === state.doc.lines
}

function escapeOn(
  key: 'up' | 'down' | 'left' | 'right',
  direction: EscapeDirection,
  onEscape: (direction: EscapeDirection) => void,
): CodeMirrorCommand {
  return (view) => {
    if (!atEdge(view.state, key)) return false
    onEscape(direction)
    return true
  }
}

/** The keys that give the document back the caret (ADR-003: never a mouse trap). */
export function escapeKeymap(onEscape: (direction: EscapeDirection) => void): Extension {
  const leave =
    (direction: EscapeDirection): CodeMirrorCommand =>
    () => {
      onEscape(direction)
      return true
    }
  return keymap.of([
    { key: 'ArrowUp', run: escapeOn('up', -1, onEscape) },
    { key: 'ArrowLeft', run: escapeOn('left', -1, onEscape) },
    { key: 'ArrowDown', run: escapeOn('down', 1, onEscape) },
    { key: 'ArrowRight', run: escapeOn('right', 1, onEscape) },
    { key: 'Mod-Enter', run: leave(1) },
    { key: 'Escape', run: leave(1) },
  ])
}

export function createCodeMirror(options: CodeMirrorOptions): CodeMirrorHost {
  const grammar = new Compartment()
  const editable = new Compartment()
  const support = loadGrammar(options.language)

  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.text,
      extensions: [
        lineNumbers(),
        history(),
        tokenHighlighting,
        // CodeMirror gives its content element `role="textbox"`, which requires
        // an accessible name of its own; the toolbar labels the block as a
        // whole, but that label is on a sibling, not an ancestor, so it is not
        // in this element's accessible-name calculation.
        EditorView.contentAttributes.of({ 'aria-label': 'Code' }),
        escapeKeymap(options.onEscape),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        grammar.of(support === undefined ? [] : support),
        editable.of(EditorView.editable.of(options.editable)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange(update.state.doc.toString())
        }),
      ],
    }),
  })

  return {
    view,
    setText(text: string) {
      const current = view.state.doc.toString()
      if (current === text) return
      view.dispatch({ changes: { from: 0, to: current.length, insert: text } })
    },
    setLanguage(language: EditorLanguage | undefined) {
      const next = loadGrammar(language)
      view.dispatch({ effects: grammar.reconfigure(next === undefined ? [] : next) })
    },
    setEditable(value: boolean) {
      view.dispatch({ effects: editable.reconfigure(EditorView.editable.of(value)) })
    },
    destroy() {
      view.destroy()
    },
  }
}

export interface TextChange {
  readonly from: number
  readonly to: number
  readonly text: string
}

/**
 * The smallest change that turns one string into another.
 *
 * Replacing the whole block on every keystroke would work, but it would also
 * throw away the document's undo granularity and move every position inside the
 * block. Trimming the common prefix and suffix keeps a keystroke a keystroke.
 */
export function textChange(before: string, after: string): TextChange | null {
  if (before === after) return null
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1
    endAfter -= 1
  }
  return { from: start, to: endBefore, text: after.slice(start, endAfter) }
}
