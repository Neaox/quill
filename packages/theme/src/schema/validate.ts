import { Ajv, type ErrorObject } from 'ajv'
import { curatedFace, type FaceRole } from './faces.ts'
import { ThemeDocumentSchema, type FaceReference, type ThemeDocument } from './theme-document.ts'

export type ThemeIssue = {
  /** A JSON pointer into the document, `''` for the document itself. */
  readonly path: string
  readonly message: string
  readonly rule: string
}

export type ValidationResult =
  | { readonly valid: true; readonly document: ThemeDocument }
  | { readonly valid: false; readonly issues: readonly ThemeIssue[] }

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true })
const validator = ajv.compile<ThemeDocument>(ThemeDocumentSchema)

/** Exposed as its own step so a caller running ajv itself can reuse the shape. */
export const toIssues = (
  errors: readonly ErrorObject[] | null | undefined,
): readonly ThemeIssue[] => (errors ?? []).map(toIssue)

const toIssue = (error: ErrorObject): ThemeIssue => ({
  path: error.instancePath,
  message: `${error.instancePath === '' ? 'the theme document' : error.instancePath} ${error.message}`,
  rule: error.keyword,
})

const GENERIC_FOR_ROLE: Record<FaceRole, readonly string[]> = {
  display: ['serif', 'sans-serif'],
  reading: ['serif', 'sans-serif'],
  interface: ['sans-serif'],
  mono: ['monospace'],
}

/**
 * Checks the schema cannot express: a curated face must declare the role it is
 * being used for, and an uploaded face must fall back to a generic that suits
 * it, because a proportional fallback under a code block ruins the block.
 */
const faceIssues = (role: FaceRole, face: FaceReference): readonly ThemeIssue[] => {
  const path = `/type/${role}`
  if (face.source === 'curated') {
    const curated = curatedFace(face.id)
    return curated.roles.some((offered) => offered === role)
      ? []
      : [
          {
            path,
            message: `the curated face "${face.id}" is not offered for the ${role} role`,
            rule: 'face-role',
          },
        ]
  }
  return GENERIC_FOR_ROLE[role].includes(face.generic)
    ? []
    : [
        {
          path,
          message: `an uploaded ${role} face must fall back to ${GENERIC_FOR_ROLE[role].join(' or ')}`,
          rule: 'face-generic',
        },
      ]
}

const semanticIssues = (document: ThemeDocument): readonly ThemeIssue[] => {
  const roles: readonly FaceRole[] = ['display', 'reading', 'interface', 'mono']
  return roles.flatMap((role) => faceIssues(role, document.type[role]))
}

/** Validate an unknown value as a theme document, reporting every problem at once. */
export const validateThemeDocument = (input: unknown): ValidationResult => {
  if (!validator(input)) {
    return { valid: false, issues: toIssues(validator.errors) }
  }
  const issues = semanticIssues(input)
  return issues.length === 0 ? { valid: true, document: input } : { valid: false, issues }
}
