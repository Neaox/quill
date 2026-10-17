import type { EditorPaletteCommand } from '@quill/editor'

/**
 * What the open editor offers the command palette (ADR-042, "Authoring surface").
 *
 * The palette is mounted by the signed-in layout and the editor deep inside a
 * document, with nothing between them but the router, so the editor does not
 * hand the palette anything: it *registers a source*, a function the palette
 * asks when it opens, and removes it when it unmounts (an observer, as
 * `subscribe` returns the unsubscribe). Asking at that moment is what makes the
 * list true to the cursor *now*: "Show link as card" is offered only when the
 * cursor is in a link and a card could go there.
 *
 * A module-level list rather than a context, because there is one palette and
 * one editor with the author's attention, and a context would have to be
 * provided above both.
 */

export type EditorCommandSource = () => readonly EditorPaletteCommand[]

const sources: EditorCommandSource[] = []

/** Registers an editor's source; the returned function removes it, and is safe to call twice. */
export function registerEditorCommands(source: EditorCommandSource): () => void {
  sources.unshift(source)
  return () => {
    const index = sources.indexOf(source)
    if (index >= 0) sources.splice(index, 1)
  }
}

/** The commands every registered editor offers now, the most recently opened editor's first. */
export function currentEditorCommands(): readonly EditorPaletteCommand[] {
  return sources.flatMap((source) => source())
}
