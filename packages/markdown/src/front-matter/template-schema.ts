import { Type } from '@sinclair/typebox'
import type { Static, TSchema } from '@sinclair/typebox'

/** ADR-029: the answer types a template question may ask for. */
export const TEMPLATE_QUESTION_TYPES = [
  'boolean',
  'choice',
  'text',
  'date',
  'document',
  'user',
] as const

export type TemplateQuestionType = (typeof TEMPLATE_QUESTION_TYPES)[number]

export const TemplateQuestionSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  type: Type.Unsafe<TemplateQuestionType>({
    type: 'string',
    enum: [...TEMPLATE_QUESTION_TYPES],
  }),
  options: Type.Optional(Type.Array(Type.String())),
  default: Type.Optional(Type.Unknown()),
  optional: Type.Optional(Type.Boolean()),
  help: Type.Optional(Type.String()),
})

export const TemplateSectionSchema = Type.Object({
  heading: Type.String({ minLength: 1 }),
  required: Type.Optional(Type.Boolean()),
  optional: Type.Optional(Type.Boolean()),
  /** A question id, or a small expression over answers; see `evaluateCondition`. */
  when: Type.Optional(Type.String({ minLength: 1 })),
})

/**
 * The `template:` block a template document declares about itself (ADR-029). A
 * document *created from* a template carries `TemplateReferenceSchema` instead.
 */
export const TemplateDeclarationSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    category: Type.Optional(Type.String({ minLength: 1 })),
    version: Type.Integer({ minimum: 1 }),
    questions: Type.Optional(Type.Array(TemplateQuestionSchema)),
    sections: Type.Optional(Type.Array(TemplateSectionSchema)),
    metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: true },
)

/** What a created document remembers: enough to offer it later improvements. */
export const TemplateReferenceSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    version: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: true },
)

export type TemplateQuestion = Static<typeof TemplateQuestionSchema>
export type TemplateSection = Static<typeof TemplateSectionSchema>
export type TemplateDeclaration = Static<typeof TemplateDeclarationSchema>
export type TemplateReference = Static<typeof TemplateReferenceSchema>

export const TemplateSchema: TSchema = Type.Union([
  TemplateReferenceSchema,
  TemplateDeclarationSchema,
])

/**
 * Whether a `template:` front matter value is a template's own declaration
 * rather than a created document's reference to one (ADR-029).
 *
 * A reference is exactly `{ id, version }`; anything else that is an object is
 * read as a declaration, so a template that has not named itself yet is still
 * treated as a template. The distinction decides whether a publish strips
 * authoring blocks: they are the template's *content* and must survive its
 * own publish, and are stripped only from a document created from it.
 */
export function isTemplateDeclaration(value: unknown): value is TemplateDeclaration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate['name'] === 'string' || typeof candidate['id'] !== 'string'
}
