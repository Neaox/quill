import type { RootContent } from 'mdast'

import { mdastToProseMirror } from './from-mdast.ts'
import { liftLayout } from './layout.ts'

/**
 * A run of mdast blocks as the editor's blocks, in JSON: the form a piece of a
 * long paste crosses from the parse worker to the page in (quill-plan.md
 * section 31). Converting here, beside the parse, leaves the page only
 * `Node.fromJSON`, and JSON without mdast's positions is half the size to
 * copy across.
 *
 * Front matter is dropped: pasting a whole file into the middle of a document
 * brings its prose, not a second metadata block (`commands.ts` in the editor
 * does the same for a paste parsed in the page).
 */

/** A ProseMirror node as `Node.toJSON` writes it. */
export interface NodeJson {
  readonly type: string
  readonly attrs?: Readonly<Record<string, unknown>>
  readonly content?: readonly NodeJson[]
  readonly text?: string
  readonly marks?: readonly {
    readonly type: string
    readonly attrs?: Readonly<Record<string, unknown>>
  }[]
}

export function blocksFromMdast(children: readonly RootContent[]): NodeJson[] {
  const body = children.filter((child) => child.type !== 'yaml')
  // The converter gives an empty document a paragraph, which a piece of a
  // paste with nothing in it must not bring.
  if (body.length === 0) return []
  const { doc } = mdastToProseMirror({ type: 'root', children: body })
  const json: { readonly content?: readonly NodeJson[] } = liftLayout(doc).toJSON()
  /* v8 ignore next -- a document of one block or more always has its content. */
  return [...(json.content ?? [])]
}
