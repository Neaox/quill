import type { ContainerDirective } from 'mdast-util-directive'

import type { DirectiveContent, DirectiveDefinition, DirectiveIssue } from './definition.ts'
import { attribute, bodyOf, issue } from './definition.ts'

export interface WhenSection {
  /** A question id, or a small expression over answers. See `evaluateCondition`. */
  readonly question: string
  readonly children: DirectiveContent
}

/**
 * `:::when{question=securityReview}` (ADR-029). Conditions resolve when the
 * document is created and when a question is re-answered; a `when` block is never
 * present in a document a reader sees.
 */
export const whenDirective: DirectiveDefinition<WhenSection, ContainerDirective> = {
  names: ['when'],
  kinds: ['container'],

  parse(node: ContainerDirective): WhenSection {
    return { question: attribute(node, 'question') ?? '', children: bodyOf(node) }
  },

  validate(node: ContainerDirective): readonly DirectiveIssue[] {
    const question = attribute(node, 'question')
    if (question !== undefined && question.trim().length > 0) return []
    return [issue('question', 'A when block needs a question to depend on.', 'error')]
  },

  serialize(model: WhenSection): ContainerDirective {
    return {
      type: 'containerDirective',
      name: 'when',
      attributes: { question: model.question },
      children: model.children,
    }
  },
}
