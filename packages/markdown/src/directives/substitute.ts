import type { TemplateAnswers } from './condition.ts'

/** `{{ answers.securityReview }}` — the only substitution a template may use. */
const ANSWER_PATTERN = /\{\{\s*answers\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

/**
 * Replaces answer references with their values. Substitution happens once, when a
 * document is created or a question is re-answered; a published document never
 * contains machinery a reader could see (ADR-029).
 *
 * Callers apply this to the *value* of `text`, `inlineCode` and `code` nodes and
 * to nothing else (`resolve-template.ts`), which is the surface ADR-029 records.
 * An answer is data a person typed into a form, so it must never be able to
 * become structure: substituting into a link's url or a directive's attributes
 * would let an answer choose where a link points or what a block does, and
 * substituting into a raw node would let it introduce Markdown of its own. Into
 * a text or code node it can only ever be the characters it is.
 */
export function substituteAnswers(text: string, answers: TemplateAnswers): string {
  return text.replaceAll(ANSWER_PATTERN, (_match: string, id: string) => {
    const value = answers[id]
    return value === undefined || value === null ? '' : String(value)
  })
}
