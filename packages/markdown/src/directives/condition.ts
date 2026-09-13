/** The answers a template's questions have been given, keyed by question id. */
export type TemplateAnswers = Readonly<Record<string, unknown>>

/**
 * One piece of an expression: a quoted literal (kept whole), one of the four
 * operators, or a single character of everything else.
 *
 * Splitting on `||`, `&&`, `==` and `!=` with `String.split` read those
 * characters inside a quoted literal as operators, so `audience == "internal &&
 * external"` split into two clauses and evaluated to nonsense, and
 * `conditionIdentifiers` reported `external"` as a question id. Scanning
 * literals as single pieces is what makes a quoted value opaque, which is the
 * whole reason quoting exists. An unterminated quote runs to the end of the
 * expression rather than falling back to character-by-character scanning, so a
 * half-typed condition cannot suddenly mean something else.
 */
const PIECE = /"[^"]*"?|'[^']*'?|\|\||&&|==|!=|[\s\S]/g

type Operator = '==' | '!='

/** An expression as `||` groups of `&&` atoms, with quoted literals intact. */
function clauses(expression: string): string[][] {
  const groups: string[][] = []
  let group: string[] = []
  let atom = ''
  for (const match of expression.matchAll(PIECE)) {
    const piece = match[0]
    if (piece === '&&' || piece === '||') {
      group.push(atom)
      atom = ''
      if (piece === '||') {
        groups.push(group)
        group = []
      }
      continue
    }
    atom += piece
  }
  group.push(atom)
  groups.push(group)
  return groups
}

interface Comparison {
  readonly left: string
  readonly operator: Operator
  readonly right: string
}

/** An atom split at its first top-level `==` or `!=`, or null when it has none. */
function comparison(atom: string): Comparison | null {
  let left = ''
  for (const match of atom.matchAll(PIECE)) {
    const piece = match[0]
    if (piece === '==' || piece === '!=') {
      return { left, operator: piece, right: atom.slice(left.length + 2) }
    }
    left += piece
  }
  return null
}

/**
 * `when` takes a question id or a small expression over answers (ADR-029):
 *
 * ```text
 * securityReview                 truthy answer
 * !securityReview                negation
 * status == accepted             comparison against a literal
 * audience != "internal only"    quoted literal
 * scope == "a && b"              an operator inside a literal is just text
 * a && b || c                    && binds tighter than ||
 * ```
 *
 * There are no parentheses and no function calls: a template is a starting point,
 * not a program.
 */
export function evaluateCondition(expression: string, answers: TemplateAnswers): boolean {
  return clauses(expression).some((group) => group.every((atom) => evaluateAtom(atom, answers)))
}

/** The question ids an expression reads, so a template can be checked against them. */
export function conditionIdentifiers(expression: string): readonly string[] {
  return clauses(expression)
    .flat()
    .map((atom) => identifierOf(atom))
    .filter((identifier) => identifier.length > 0)
}

function identifierOf(atom: string): string {
  const trimmed = atom.trim().replace(/^!+/, '')
  const left = (comparison(trimmed)?.left ?? trimmed).trim()
  // A literal on the left compares two constants; it names no question.
  return left.startsWith('"') || left.startsWith("'") ? '' : left
}

function evaluateAtom(atom: string, answers: TemplateAnswers): boolean {
  const trimmed = atom.trim()
  if (trimmed.startsWith('!')) return !evaluateAtom(trimmed.slice(1), answers)
  const found = comparison(trimmed)
  if (found === null) return isTruthy(answers[trimmed])
  const equal = asText(answers[found.left.trim()]) === unquote(found.right.trim())
  return found.operator === '==' ? equal : !equal
}

function unquote(literal: string): string {
  const quoted = /^(?<quote>["'])(?<value>.*)\k<quote>$/s.exec(literal)
  return quoted?.groups?.['value'] ?? literal
}

function asText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

function isTruthy(value: unknown): boolean {
  if (typeof value === 'string') return value.length > 0 && value !== 'false'
  if (Array.isArray(value)) return value.length > 0
  return Boolean(value)
}
