import type { LeafDirective } from 'mdast-util-directive'

import type {
  Directive,
  DirectiveAttributes,
  DirectiveDefinition,
  DirectiveIssue,
} from './definition.ts'
import { integerAttribute, integerIssues } from './definition.ts'

/** How many generations of child documents a block may list. */
export const CHILD_DEPTHS = [1, 2, 3, 4, 5] as const

export type ChildDepth = (typeof CHILD_DEPTHS)[number]

const DEPTH_RANGE = { min: 1, max: 5 } as const

/** The direct children only, which is the list an author almost always wants. */
export const DEFAULT_CHILD_DEPTH: ChildDepth = 1

export interface ChildDocuments {
  /** How many generations below this document are listed. */
  readonly depth: ChildDepth
}

export function isChildDepth(value: number | undefined): value is ChildDepth {
  return value !== undefined && (CHILD_DEPTHS as readonly number[]).includes(value)
}

/** The depth a `::children` lists to, from its attributes alone (see `tocLevels`). */
export function childDepth(attributes: DirectiveAttributes | null | undefined): ChildDepth {
  const depth = integerAttribute(attributes, 'depth', DEPTH_RANGE)
  return isChildDepth(depth) ? depth : DEFAULT_CHILD_DEPTH
}

/**
 * `::children{depth=2}` — the documents beneath this one.
 *
 * A live block in the sense of ADR-032: the tree changes on a different cadence
 * from this document, so the cached body holds a slot and the application fills
 * it. Outside Quill it reads as its directive line.
 */
export const childrenDirective: DirectiveDefinition<ChildDocuments, LeafDirective> = {
  names: ['children'],
  kinds: ['leaf'],

  parse: (node) => ({ depth: childDepth(node.attributes) }),

  validate(node: Directive): readonly DirectiveIssue[] {
    return integerIssues(node.attributes, 'depth', DEPTH_RANGE)
  },

  serialize(model: ChildDocuments): LeafDirective {
    return {
      type: 'leafDirective',
      name: 'children',
      attributes: { depth: String(model.depth) },
      children: [],
    }
  },
}
