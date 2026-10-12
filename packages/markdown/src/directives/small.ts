import { toString } from 'mdast-util-to-string'
import type { TextDirective } from 'mdast-util-directive'

import type { DirectiveDefinition, DirectiveIssue } from './definition.ts'
import { issue } from './definition.ts'

export interface SmallPrint {
  readonly children: TextDirective['children']
}

/**
 * `:small[Drawn from main, 11 October 2026.]` — a side comment, such as where a
 * document's facts came from, rendered as `small`, HTML's element for small
 * print. Its label keeps its formatting; outside Quill it reads as the literal
 * `:small[…]`, which still says everything it held.
 */
export const smallDirective: DirectiveDefinition<SmallPrint, TextDirective> = {
  names: ['small'],
  kinds: ['text'],

  parse(node: TextDirective): SmallPrint {
    return { children: node.children }
  },

  validate(node: TextDirective): readonly DirectiveIssue[] {
    if (toString(node).trim().length > 0) return []
    return [issue('', 'Small print needs something to say.', 'warning')]
  },

  serialize(model: SmallPrint): TextDirective {
    return { type: 'textDirective', name: 'small', attributes: {}, children: model.children }
  },
}
