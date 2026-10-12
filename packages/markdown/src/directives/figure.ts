import type { ContainerDirective } from 'mdast-util-directive'

import type {
  Directive,
  DirectiveContent,
  DirectiveDefinition,
  DirectiveIssue,
} from './definition.ts'
import { bodyOf, issue } from './definition.ts'

export interface Figure {
  /** What the figure shows: a diagram, a table, an image, a code block. */
  readonly subject: DirectiveContent
  /** The paragraphs after the subject, which describe it. */
  readonly caption: DirectiveContent
}

/**
 * `:::figure` — a block and the paragraphs that caption it, rendered as
 * `figure` and `figcaption`. The caption is every paragraph after the last
 * block that is not one, so the author writes the subject and then says what
 * it shows, in plain Markdown. A figure of paragraphs alone has nothing to
 * caption and is all subject. Outside Quill the wrapper disappears and the
 * caption reads as the prose under the block, which is what it is.
 */
export const figureDirective: DirectiveDefinition<Figure, ContainerDirective> = {
  names: ['figure'],
  kinds: ['container'],

  parse(node: ContainerDirective): Figure {
    const body = bodyOf(node)
    const split = body.findLastIndex((child) => child.type !== 'paragraph') + 1
    return split === 0
      ? { subject: body, caption: [] }
      : { subject: body.slice(0, split), caption: body.slice(split) }
  },

  validate(node: Directive): readonly DirectiveIssue[] {
    if (node.type !== 'containerDirective' || bodyOf(node).length > 0) return []
    return [issue('', 'A figure needs something to show.', 'warning')]
  },

  serialize(model: Figure): ContainerDirective {
    return {
      type: 'containerDirective',
      name: 'figure',
      attributes: {},
      children: [...model.subject, ...model.caption],
    }
  },
}
