import type { Root } from 'mdast'

import { rewriteTree } from '../tree.ts'
import { claims, isDirective } from './definition.ts'
import { notesDirective } from './notes.ts'

/**
 * Removes `:::notes` from a tree that is about to be read by someone other
 * than the presenter.
 *
 * Presenter notes are the one authoring block that *stays in the published
 * Markdown*: presentation mode reads them from the document's source, so they
 * must survive a publish, but a reader must never meet them: not in the
 * rendered body, not in the outline, not in the link index, not in the search
 * text. Every one of those readers goes through this, so the rule lives in
 * one place and a new reader cannot forget it.
 */
export function stripPresenterNotes(ast: Root): Root {
  return rewriteTree(ast, (node) =>
    isDirective(node) && node.type === 'containerDirective' && claims(notesDirective, node)
      ? []
      : undefined,
  )
}
