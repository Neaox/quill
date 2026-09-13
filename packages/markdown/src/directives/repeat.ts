import type { ContainerDirective } from 'mdast-util-directive'

import type { DirectiveContent, DirectiveDefinition, DirectiveIssue } from './definition.ts'
import { attribute, bodyOf, issue } from './definition.ts'

export interface RepeatSection {
  readonly title: string | undefined
  readonly children: DirectiveContent
}

/**
 * `:::repeat{title="Alternative"}` (ADR-029) — a section the author may add again,
 * such as one alternative per decision. Unlike the other template blocks its
 * instances are published as ordinary sections, so it survives to the reader.
 */
export const repeatDirective: DirectiveDefinition<RepeatSection, ContainerDirective> = {
  names: ['repeat'],
  kinds: ['container'],

  parse(node: ContainerDirective): RepeatSection {
    return { title: attribute(node, 'title'), children: bodyOf(node) }
  },

  validate(node: ContainerDirective): readonly DirectiveIssue[] {
    if (attribute(node, 'title') !== undefined) return []
    return [
      issue('title', 'A repeat block needs a title for its "add another" affordance.', 'error'),
    ]
  },

  serialize(model: RepeatSection): ContainerDirective {
    return {
      type: 'containerDirective',
      name: 'repeat',
      attributes: { title: model.title },
      children: model.children,
    }
  },
}
