import type { ContainerDirective } from 'mdast-util-directive'

import type { DirectiveContent, DirectiveDefinition, DirectiveIssue } from './definition.ts'
import { attribute, bodyOf, flag, issue } from './definition.ts'

export interface OptionalSection {
  readonly title: string | undefined
  /** True once the author has accepted the offer; only then is it published. */
  readonly added: boolean
  readonly children: DirectiveContent
}

/**
 * `:::optional{title="Alternatives considered"}` (ADR-029). The editor shows a
 * ghosted "Add section" affordance rather than content; accepting it sets `added`
 * and the section becomes ordinary content at publish. An offer never accepted is
 * dropped.
 */
export const optionalDirective: DirectiveDefinition<OptionalSection, ContainerDirective> = {
  names: ['optional'],
  kinds: ['container'],

  parse(node: ContainerDirective): OptionalSection {
    return { title: attribute(node, 'title'), added: flag(node, 'added'), children: bodyOf(node) }
  },

  validate(node: ContainerDirective): readonly DirectiveIssue[] {
    if (attribute(node, 'title') !== undefined) return []
    return [issue('title', 'An optional section needs a title to offer the author.', 'error')]
  },

  serialize(model: OptionalSection): ContainerDirective {
    const attributes: Record<string, string | undefined> = { title: model.title }
    if (model.added) attributes['added'] = ''
    return { type: 'containerDirective', name: 'optional', attributes, children: model.children }
  },
}
