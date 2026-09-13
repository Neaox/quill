import { toString } from 'mdast-util-to-string'
import type { TextDirective } from 'mdast-util-directive'

import type { DirectiveDefinition, DirectiveIssue } from './definition.ts'
import { issue, textChildren } from './definition.ts'

export interface KeyboardKeys {
  /** The keys as written, `Ctrl+C` or `Esc`. */
  readonly keys: string
}

/**
 * `:kbd[Ctrl+C]` — keys the reader is asked to press, rendered as `kbd`
 * (AGENTS.md rule 14: the right element for the job). Outside Quill it reads as
 * the literal `:kbd[Ctrl+C]`, which still says what to press.
 */
export const kbdDirective: DirectiveDefinition<KeyboardKeys, TextDirective> = {
  names: ['kbd'],
  kinds: ['text'],

  parse(node: TextDirective): KeyboardKeys {
    return { keys: toString(node) }
  },

  validate(node: TextDirective): readonly DirectiveIssue[] {
    if (toString(node).trim().length > 0) return []
    return [issue('', 'A keyboard directive needs the keys it names.', 'warning')]
  },

  serialize(model: KeyboardKeys): TextDirective {
    return {
      type: 'textDirective',
      name: 'kbd',
      attributes: {},
      children: textChildren(model.keys),
    }
  },
}
