import type { Root } from 'mdast'

import type { TemplateDeclaration } from '../front-matter/template-schema.ts'
import { rewriteTree } from '../tree.ts'
import type { Warning } from '../warnings.ts'
import { warning } from '../warnings.ts'
import type { TemplateAnswers } from './condition.ts'
import { conditionIdentifiers, evaluateCondition } from './condition.ts'
import { claims, isDirective } from './definition.ts'
import { substituteAnswers } from './substitute.ts'
import { whenDirective } from './when.ts'

export interface ResolvedTemplate {
  readonly ast: Root
  /** The required headings, after `when` has been evaluated against the answers. */
  readonly requiredSections: readonly string[]
  readonly warnings: readonly Warning[]
}

/**
 * Instantiates a template into a document (ADR-029): conditions are evaluated
 * and `{{ answers.id }}` is substituted. Nothing conditional survives, because a
 * reader must never see machinery and an export must never have to evaluate it.
 *
 * Optional sections are not touched. They are an offer to the author, ghosted in
 * the editor until accepted, and they live in the draft until publish strips the
 * ones never added (`stripAuthoringBlocks`).
 *
 * Required sections are returned, not enforced: the platform records what a team
 * expects of this kind of document and shows it, and publishes either way.
 */
export function resolveTemplate(
  templateAst: Root,
  declaration: TemplateDeclaration,
  answers: TemplateAnswers,
): ResolvedTemplate {
  const warnings: Warning[] = []
  const declared = new Set((declaration.questions ?? []).map((question) => question.id))

  // Memoised because the same expression is decided twice — once for the
  // `:::when` block in the body and once for the declared section that names it
  // — and an undeclared question would otherwise be warned about twice for one
  // mistake.
  const decided = new Map<string, boolean>()
  const decide = (expression: string): boolean => {
    const already = decided.get(expression)
    if (already !== undefined) return already
    for (const id of conditionIdentifiers(expression)) {
      if (!declared.has(id)) warnings.push(warning('unknown-question', id))
    }
    const result = evaluateCondition(expression, answers)
    decided.set(expression, result)
    return result
  }

  const ast = rewriteTree(templateAst, (node) => {
    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') {
      const value = substituteAnswers(node.value, answers)
      return value === node.value ? undefined : [{ ...node, value }]
    }
    if (!isDirective(node) || node.type !== 'containerDirective') return undefined
    if (claims(whenDirective, node)) {
      const section = whenDirective.parse(node)
      return decide(section.question) ? section.children : []
    }
    // `:::optional` is deliberately left alone. ADR-029 makes it a ghosted "Add
    // section" affordance the author can accept at any point while drafting, so
    // resolving it at creation would delete the offer before it was ever made.
    // `stripAuthoringBlocks` is what removes the ones never added, at publish.
    return undefined
  })

  const requiredSections = (declaration.sections ?? [])
    .filter((section) => section.required === true)
    .filter((section) => section.when === undefined || decide(section.when))
    .map((section) => section.heading)

  return { ast, requiredSections, warnings }
}
