import {
  liftLayout,
  mdastToProseMirror,
  proseMirrorToMdast,
  schema as markdownSchema,
  wrapLayout,
} from '@quill/markdown'
import type { SoftBreakMode, Warning } from '@quill/markdown'
import type { Node as PMNode } from '@tiptap/pm/model'

import type { DocumentAst } from '../document-ast.ts'
import { editorSchema } from '../schema/editor-schema.ts'

/**
 * The two conversions at the editor's boundary, and the only place the editor
 * and the AST meet.
 *
 * The AST is what is saved (ADR-021); editor JSON is never persisted. Both
 * directions go through the Markdown package's converter and its layout lift, so
 * the author sees a block at its chosen width rather than a `:::wide` wrapper
 * (ADR-027), and the wrapper comes back on the way out.
 *
 * The two schemas differ by exactly the fields `prosemirror-tables` maintains, so
 * the hop between them is a JSON round trip: ProseMirror fills in the defaults it
 * declares and ignores the attributes it does not.
 */

export interface LoadedDocument {
  readonly doc: PMNode
  readonly warnings: readonly Warning[]
}

export interface SavedDocument {
  readonly tree: DocumentAst
  readonly warnings: readonly Warning[]
}

export interface LoadOptions {
  /**
   * `preserve` keeps a source-wrapped paragraph as it was written, which is what
   * a document that is opened and not edited needs. `collapse` models what a live
   * editor does to it, and is the formatting-only normalisation ADR-002 licenses
   * once, on first publish.
   */
  readonly softBreaks?: SoftBreakMode
}

export function documentFromMdast(tree: DocumentAst, options: LoadOptions = {}): LoadedDocument {
  const softBreaks = options.softBreaks ?? 'preserve'
  const { doc, warnings } = mdastToProseMirror(tree, { softBreaks })
  return { doc: editorSchema.nodeFromJSON(liftLayout(doc).toJSON()), warnings }
}

export function documentToMdast(doc: PMNode): SavedDocument {
  const converted = markdownSchema.nodeFromJSON(doc.toJSON())
  return proseMirrorToMdast(wrapLayout(converted))
}
