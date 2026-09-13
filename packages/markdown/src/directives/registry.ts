import { visit } from 'unist-util-visit'
import type { Root } from 'mdast'

import type { Directive, DirectiveIssue, DirectiveValidator } from './definition.ts'
import { claims, isDirective } from './definition.ts'
import { calloutDirective } from './callout.ts'
import { guidanceDirective } from './guidance.ts'
import { kbdDirective } from './kbd.ts'
import { layoutDirective } from './layout.ts'
import { notesDirective } from './notes.ts'
import { optionalDirective } from './optional.ts'
import { placeholderDirective } from './placeholder.ts'
import { repeatDirective } from './repeat.ts'
import { whenDirective } from './when.ts'

/** Every directive this package defines. A name absent from here is not an error. */
export const KNOWN_DIRECTIVES: readonly DirectiveValidator[] = [
  calloutDirective,
  layoutDirective,
  kbdDirective,
  placeholderDirective,
  guidanceDirective,
  optionalDirective,
  whenDirective,
  repeatDirective,
  notesDirective,
]

export function findDirective(node: Directive): DirectiveValidator | undefined {
  return KNOWN_DIRECTIVES.find((definition) => claims(definition, node))
}

/**
 * Checks every directive in a document. An unknown directive produces no issue:
 * it is preserved and rendered as its children, because a document written against
 * a newer or private vocabulary must still open (ADR-002).
 */
export function validateDirectives(tree: Root): readonly DirectiveIssue[] {
  const issues: DirectiveIssue[] = []
  let ordinal = 0
  visit(tree, (node) => {
    if (!isDirective(node)) return
    const position = ordinal
    ordinal += 1
    const definition = findDirective(node)
    if (definition === undefined) return
    for (const found of definition.validate(node)) {
      const suffix = found.path.length === 0 ? '' : `.${found.path}`
      issues.push({ ...found, path: `${node.name}[${position}]${suffix}` })
    }
  })
  return issues
}
