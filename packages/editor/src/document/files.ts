import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/**
 * Files brought into the editor by dragging or pasting.
 *
 * The editor recognises them and does nothing with them: it raises a request,
 * exactly as the slash menu does for an image address, because uploading is
 * the application's business and this package makes no requests (ADR-003). The
 * decision — are these files, and is this a place files belong? — is a pure
 * function, so every case is a table test rather than a simulated drag.
 */

/** What the editor needs of a file; `File` satisfies it, and so does a test's stand-in. */
export interface DroppedFile {
  readonly name: string
  readonly type: string
  readonly size: number
}

export interface FileDropInput {
  readonly files: readonly DroppedFile[]
  /** Inside a code block, a drop is text being moved, not a picture being added. */
  readonly inCode: boolean
}

export type FileAction =
  | { readonly kind: 'default' }
  | { readonly kind: 'files'; readonly files: readonly DroppedFile[] }

/**
 * Whether this drop or paste is files the application should be told about.
 *
 * A paste of an image carries both a file and, often, an HTML fragment
 * describing it; the file wins, because what the person copied was a picture.
 * A file with no bytes is a directory in most browsers, and dragging a folder
 * onto a document is not a thing this editor pretends to do.
 */
export function chooseFiles(input: FileDropInput): FileAction {
  if (input.inCode) return { kind: 'default' }
  const files = input.files.filter((file) => file.size > 0)
  return files.length === 0 ? { kind: 'default' } : { kind: 'files', files }
}

export interface FileRequest {
  /** In the order they were dropped. The application decides what to do with more than one. */
  readonly files: readonly File[]
}

export interface FileDropOptions {
  onFiles(request: FileRequest): void
}

export const fileDropKey = new PluginKey('editorFileDrop')

function inCode(view: EditorView): boolean {
  return view.state.selection.$from.parent.type.spec.code === true
}

/**
 * Puts the caret where the file was dropped, so what is inserted afterwards
 * lands where the person aimed rather than where they last typed.
 */
function placeCaret(view: EditorView, event: DragEvent): void {
  const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
  /* v8 ignore next -- a drop inside the editor always resolves to a position. */
  if (at === null) return
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at.pos)))
}

export function fileDrop(options: FileDropOptions): Extension {
  return Extension.create({
    name: 'fileDrop',
    addProseMirrorPlugins: () => [
      new Plugin({
        key: fileDropKey,
        props: {
          handleDrop: (view, event) => {
            /* v8 ignore next -- ProseMirror's own drop handler returns before
               it consults this one when the event carries no transfer, so the
               fallback satisfies `DataTransfer | null` and is never taken. */
            const files = [...(event.dataTransfer?.files ?? [])]
            const action = chooseFiles({ files, inCode: inCode(view) })
            if (action.kind === 'default') return false
            event.preventDefault()
            placeCaret(view, event)
            options.onFiles({ files })
            return true
          },
          handlePaste: (view, event) => {
            const files = [...(event.clipboardData?.files ?? [])]
            const action = chooseFiles({ files, inCode: inCode(view) })
            if (action.kind === 'default') return false
            event.preventDefault()
            options.onFiles({ files })
            return true
          },
        },
      }),
    ],
  })
}
