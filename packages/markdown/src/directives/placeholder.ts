import { toString } from 'mdast-util-to-string'
import type { ContainerDirective, TextDirective } from 'mdast-util-directive'

import type { DirectiveDefinition, DirectiveIssue } from './definition.ts'
import { issue, textChildren } from './definition.ts'

export interface Placeholder {
  /** The prompt the author is meant to replace. */
  readonly prompt: string
  /** Block placeholders stand for a whole section; inline ones for a phrase. */
  readonly block: boolean
}

/**
 * `:placeholder[Say what changed]` inline and `:::placeholder` as a block
 * (ADR-029). Authoring scaffolding: a publish reports any that remain and removes
 * them, so a placeholder never reaches a reader.
 */
export const placeholderDirective: DirectiveDefinition<
  Placeholder,
  ContainerDirective | TextDirective
> = {
  names: ['placeholder'],
  kinds: ['container', 'text'],

  parse(node: ContainerDirective | TextDirective): Placeholder {
    return { prompt: toString(node), block: node.type === 'containerDirective' }
  },

  validate(node: ContainerDirective | TextDirective): readonly DirectiveIssue[] {
    if (toString(node).trim().length > 0) return []
    return [issue('', 'A placeholder needs a prompt saying what belongs here.', 'warning')]
  },

  serialize(model: Placeholder): ContainerDirective | TextDirective {
    if (!model.block) {
      return {
        type: 'textDirective',
        name: 'placeholder',
        attributes: {},
        children: textChildren(model.prompt),
      }
    }
    return {
      type: 'containerDirective',
      name: 'placeholder',
      attributes: {},
      children: [{ type: 'paragraph', children: textChildren(model.prompt) }],
    }
  },
}
