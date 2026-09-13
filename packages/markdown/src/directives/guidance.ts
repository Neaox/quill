import type { ContainerDirective } from 'mdast-util-directive'

import type { DirectiveContent, DirectiveDefinition, DirectiveIssue } from './definition.ts'
import { bodyOf, issue } from './definition.ts'

export interface Guidance {
  readonly children: DirectiveContent
}

/**
 * `:::guidance` (ADR-029) — advice to the author about how to fill a section in.
 * Dismissible in the editor, removed at publish, and readable as ordinary prose in
 * any other Markdown renderer.
 */
export const guidanceDirective: DirectiveDefinition<Guidance, ContainerDirective> = {
  names: ['guidance'],
  kinds: ['container'],

  parse(node: ContainerDirective): Guidance {
    return { children: bodyOf(node) }
  },

  validate(node: ContainerDirective): readonly DirectiveIssue[] {
    if (node.children.length > 0) return []
    return [
      issue('', 'A guidance block with no content has nothing to tell the author.', 'warning'),
    ]
  },

  serialize(model: Guidance): ContainerDirective {
    return {
      type: 'containerDirective',
      name: 'guidance',
      attributes: {},
      children: model.children,
    }
  },
}
