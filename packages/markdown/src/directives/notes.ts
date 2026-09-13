import type { ContainerDirective } from 'mdast-util-directive'

import type { DirectiveContent, DirectiveDefinition, DirectiveIssue } from './definition.ts'
import { bodyOf, issue } from './definition.ts'

export interface PresenterNotes {
  readonly children: DirectiveContent
}

/**
 * `:::notes` — what the presenter says, not what the slide shows. Kept in the
 * published Markdown source, which is where presentation mode reads it from,
 * and kept out of everything a reader is served: the rendered body, the
 * outline, the link index, the search text, and export
 * (`stripPresenterNotes`).
 */
export const notesDirective: DirectiveDefinition<PresenterNotes, ContainerDirective> = {
  names: ['notes'],
  kinds: ['container'],

  parse(node: ContainerDirective): PresenterNotes {
    return { children: bodyOf(node) }
  },

  validate(node: ContainerDirective): readonly DirectiveIssue[] {
    if (node.children.length > 0) return []
    return [issue('', 'An empty presenter note has nothing to say.', 'warning')]
  },

  serialize(model: PresenterNotes): ContainerDirective {
    return { type: 'containerDirective', name: 'notes', attributes: {}, children: model.children }
  },
}
