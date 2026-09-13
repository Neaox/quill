import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'
import {
  LayoutSchema,
  OrganisationSettingsSchema,
  WorkspaceSettingsSchema,
} from '@quill/application'
import type { OrganisationSettings } from '@quill/application'
import type { ThemeReport } from '@quill/theme'

/**
 * The wire shapes for the settings API.
 *
 * The two document schemas are the *same* TypeBox objects the settings file
 * is validated with (`@quill/application`), not copies of them: what the API
 * accepts and what the YAML file may say cannot drift apart, and the OpenAPI
 * description and the generated client follow the file format for free.
 *
 * Every body states `additionalProperties: false`, and these routes compile
 * their schemas with an Ajv that neither coerces nor strips (`settings.ts`),
 * so a field this release does not know is a `400` rather than a silent
 * success that did something else.
 */

/**
 * A revision as it travels: forty hex characters, or null.
 *
 * The pattern is on the wire schema rather than left to the content store, so
 * a malformed one is the same `400` whichever backend is configured — the
 * filesystem backend refuses it outright, the in-memory one shrugs and reports
 * a conflict, and a client cannot be asked to tell those apart.
 */
const REVISION_PATTERN = '^[0-9a-f]{40}$'

const RevisionSchema = Type.Union([Type.String({ pattern: REVISION_PATTERN }), Type.Null()], {
  description: 'The revision the settings were read at; null before anything is saved.',
})

/**
 * The organisation's document as a shared component, so the description names
 * it once rather than inlining a whole theme document in every request and
 * reply that carries one.
 */
export const OrganisationSettingsDocumentSchema = Type.Unsafe<OrganisationSettings>({
  ...OrganisationSettingsSchema,
  $id: 'OrganisationSettings',
})

const organisationSettings = Type.Ref(OrganisationSettingsDocumentSchema)

/**
 * A workspace's own settings are small — a version, an id, and an optional
 * layout — so they are described inline. Only the organisation's document
 * earns a shared component, because it carries a whole theme.
 */
const workspaceSettings = WorkspaceSettingsSchema

export const OrganisationSettingsResponseSchema = Type.Object(
  { revision: RevisionSchema, settings: organisationSettings },
  { $id: 'OrganisationSettingsResponse' },
)

export const WorkspaceSettingsResponseSchema = Type.Object(
  {
    revision: RevisionSchema,
    settings: workspaceSettings,
    /** Resolved down ADR-028's table, so a client never resolves it itself. */
    effective: Type.Object({
      layout: LayoutSchema,
      layoutSource: Type.Union([Type.Literal('workspace'), Type.Literal('organisation')]),
      layoutLocked: Type.Boolean(),
    }),
  },
  { $id: 'WorkspaceSettingsResponse' },
)

/** Advisory: the theme doctor reports, it does not refuse (ADR-028). */
export const ThemeReportSchema = Type.Object(
  {
    themeId: Type.String(),
    results: Type.Array(
      Type.Object({
        id: Type.String(),
        section: Type.Integer(),
        title: Type.String(),
        status: Type.Union([Type.Literal('pass'), Type.Literal('adjusted'), Type.Literal('warn')]),
        detail: Type.String(),
        enforced: Type.Boolean(),
      }),
    ),
    summary: Type.Object({
      pass: Type.Integer(),
      adjusted: Type.Integer(),
      warn: Type.Integer(),
    }),
    adjustments: Type.Array(
      Type.Object({
        role: Type.String(),
        property: Type.String(),
        reason: Type.String(),
        from: Type.Number(),
        to: Type.Number(),
      }),
    ),
    enforcedRulesHold: Type.Boolean(),
  },
  { $id: 'ThemeReport' },
)

export const UpdateOrganisationSettingsBodySchema = Type.Object(
  {
    settings: organisationSettings,
    expectedRevision: RevisionSchema,
    changeNote: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  },
  { additionalProperties: false },
)

export const UpdateWorkspaceSettingsBodySchema = Type.Object(
  {
    settings: workspaceSettings,
    expectedRevision: RevisionSchema,
    changeNote: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  },
  { additionalProperties: false },
)

export const UpdatedOrganisationSettingsSchema = Type.Object({
  revision: Type.String(),
  settings: organisationSettings,
  report: ThemeReportSchema,
})

export const UpdatedWorkspaceSettingsSchema = Type.Object({
  revision: Type.String(),
  settings: workspaceSettings,
})

/**
 * A secret, without its value. Every route in this family answers with this
 * shape and no other, which is how "values are never returned" is a property
 * of the schema rather than a habit (ADR-034).
 */
export const SecretSchema = Type.Object(
  {
    name: Type.String(),
    keyId: Type.String(),
    createdAt: Type.String({ format: 'date-time' }),
    /** When an administrator last replaced the value. */
    rotatedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    /** When a master-key rotation last re-wrapped its data key. */
    rewrappedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  },
  { $id: 'Secret' },
)

/**
 * The bounds on a secret's value are stated once, in the use case
 * (`MAX_SECRET_VALUE_LENGTH`), and not again here: two statements of one limit
 * drift, and the use case's answer — `422 invalid_secret_value` with the
 * reason — tells an administrator more than a schema's `400` would. The
 * schema's job is the shape, and that unknown fields are refused.
 */
export const SetSecretBodySchema = Type.Object(
  { value: Type.String() },
  { additionalProperties: false },
)

export type ThemeReportResponse = Static<typeof ThemeReportSchema>

/** The doctor's report as it travels: the same verdicts, as plain JSON. */
export function themeReportResponse(report: ThemeReport): ThemeReportResponse {
  return {
    themeId: report.themeId,
    results: report.results.map((result) => ({
      id: result.id,
      section: result.section,
      title: result.title,
      status: result.status,
      detail: result.detail,
      enforced: result.enforced,
    })),
    summary: report.summary,
    adjustments: report.adjustments.map((adjustment) => ({ ...adjustment })),
    enforcedRulesHold: report.enforcedRulesHold,
  }
}
