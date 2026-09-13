/**
 * A template's declaration, read from the front matter of the document it is
 * (ADR-029).
 *
 * There is no "list the templates" route and there does not need to be: a
 * template is an ordinary published document in the workspace's Templates
 * collection, and what makes it a template is the `template:` block in its
 * front matter. So discovery is the workspace tree the New document dialog
 * already reads, and the questions come from the template's own published
 * content.
 *
 * Front matter is whatever an author wrote, so every field here is checked
 * rather than assumed. An unreadable declaration yields a template with no
 * questions, which still scaffolds the document correctly — the server
 * instantiates it either way.
 */

/** The slug of the collection templates live in (ADR-029: "stored in a Templates collection"). */
export const TEMPLATE_COLLECTION_SLUG = 'templates'

/** The answer types ADR-029 declares. Everything else is asked for as text. */
export type TemplateQuestionType = 'boolean' | 'choice' | 'text' | 'date' | 'document' | 'user'

export interface TemplateQuestion {
  readonly id: string
  readonly label: string
  readonly type: TemplateQuestionType
  readonly options: readonly string[]
  readonly optional: boolean
  readonly help: string | undefined
  readonly defaultValue: string | boolean | undefined
}

export interface TemplateDeclaration {
  readonly name: string | undefined
  readonly category: string | undefined
  readonly questions: readonly TemplateQuestion[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const QUESTION_TYPES: ReadonlySet<string> = new Set([
  'boolean',
  'choice',
  'text',
  'date',
  'document',
  'user',
])

function readQuestion(value: unknown): TemplateQuestion | undefined {
  if (!isRecord(value)) return undefined
  const id = optionalString(value['id'])
  if (id === undefined) return undefined
  const rawType = value['type']
  const type: TemplateQuestionType =
    typeof rawType === 'string' && QUESTION_TYPES.has(rawType)
      ? (rawType as TemplateQuestionType)
      : 'text'
  const options = Array.isArray(value['options'])
    ? value['options'].filter((option): option is string => typeof option === 'string')
    : []
  const fallback = value['default']
  return {
    id,
    label: optionalString(value['label']) ?? id,
    type,
    options,
    optional: value['optional'] === true,
    help: optionalString(value['help']),
    defaultValue:
      typeof fallback === 'string' || typeof fallback === 'boolean' ? fallback : undefined,
  }
}

/** The `template:` block of a document's front matter, or `null` if it has none. */
export function readTemplateDeclaration(
  frontMatter: Readonly<Record<string, unknown>> | undefined,
): TemplateDeclaration | null {
  const declaration = frontMatter?.['template']
  if (!isRecord(declaration)) return null
  const questions = Array.isArray(declaration['questions'])
    ? declaration['questions'].flatMap((question) => {
        const parsed = readQuestion(question)
        return parsed === undefined ? [] : [parsed]
      })
    : []
  return {
    name: optionalString(declaration['name']),
    category: optionalString(declaration['category']),
    questions,
  }
}

/** The answers a template starts with, before anyone touches the form. */
export function defaultAnswers(
  declaration: TemplateDeclaration | null,
): Record<string, string | boolean> {
  const answers: Record<string, string | boolean> = {}
  for (const question of declaration?.questions ?? []) {
    if (question.defaultValue !== undefined) answers[question.id] = question.defaultValue
    else if (question.type === 'boolean') answers[question.id] = false
    else if (question.type === 'choice') answers[question.id] = question.options[0] ?? ''
    else answers[question.id] = ''
  }
  return answers
}

/**
 * The answers worth sending: an unanswered optional question is not an empty
 * answer, it is no answer, and a document's front matter should not gain a
 * blank field because a question was skipped.
 */
export function answersToSend(
  declaration: TemplateDeclaration | null,
  answers: Readonly<Record<string, string | boolean>>,
): Record<string, string | boolean> {
  const sent: Record<string, string | boolean> = {}
  for (const question of declaration?.questions ?? []) {
    const answer = answers[question.id]
    if (answer === undefined || answer === '') continue
    sent[question.id] = answer
  }
  return sent
}
