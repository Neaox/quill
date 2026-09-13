import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv'
import { type Static, Type } from '@sinclair/typebox'

import { BRAND } from '@quill/brand'
import { workspaceId } from '@quill/domain'
import { DEFAULT_THEME, ThemeDocumentSchema, validateThemeDocument } from '@quill/theme'
import type { ThemeDocument } from '@quill/theme'

import { createVersionedReader } from '../use-cases/versioned-reader.ts'
import { LayoutSchema, type Layout } from './layout.ts'

/**
 * The settings documents an administrator edits in the product and the
 * application keeps as versioned YAML files in the content store (ADR-034).
 *
 * Two things make this a file rather than a row. It has history, an author,
 * and a change note for free, because it is written through the same publish
 * path documents are; and it moves to another instance by being copied, which
 * is only safe because a settings file **never carries a secret value**. Where
 * a secret belongs — an OIDC client secret, an SMTP password — the file
 * carries a {@link SecretReference}, and the secret itself lives
 * envelope-encrypted in Postgres under that name.
 *
 * Every document carries a `version` and every reader dispatches on it
 * (ADR-033, rule 17): `parseOrganisationSettings` accepts every version this
 * product has ever written, and a document from a *newer* release reads as
 * null rather than being guessed at.
 */

export const SETTINGS_VERSION = 1

/**
 * The content-store workspace settings files live in (ADR-034).
 *
 * It is a workspace to the content store — a bare repository with a history —
 * and to nothing else: it has no row in `workspaces`, so no picker lists it,
 * no grant can name it, and no document route can reach it. A fixed id rather
 * than a generated one because a restore from files alone has to find it.
 */
export const SYSTEM_WORKSPACE_ID = workspaceId('00000000-0000-4000-8000-000000000000')

/** Where in the system workspace each document lives (ADR-034). */
export const ORGANISATION_SETTINGS_PATH = `.${BRAND.slug}/organisation.yaml`

export function workspaceSettingsPath(id: string): string {
  return `.${BRAND.slug}/workspaces/${id}.yaml`
}

/**
 * A secret's name, which is all a settings file ever holds of it: a path-like
 * label such as `oidc/entra/client-secret`. Lower-case so that two
 * administrators cannot create two secrets whose names differ only in case.
 */
export const SECRET_NAME_PATTERN = '^[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*)*$'

export const SecretReferenceSchema = Type.Object(
  { secret: Type.String({ pattern: SECRET_NAME_PATTERN, maxLength: 200 }) },
  { additionalProperties: false },
)

export type SecretReference = Static<typeof SecretReferenceSchema>

/**
 * The organisation's logo, kept in the blob store and referenced by hash.
 *
 * TODO(M3): nothing can store or serve one yet. `BlobStore` is a declared
 * port with no implementation on `AppDependencies`, so a hash saved here
 * resolves to nothing until the attachments work merges; the field is in the
 * document now because onboarding's first step is "upload a logo" (ADR-028)
 * and a settings file that gained it later would be a version bump (see
 * ADR-034's consequences on that trade).
 */
const LogoSchema = Type.Object(
  {
    /** Lower-case hex SHA-256, the `BlobRef.hash` the upload returned. */
    hash: Type.String({ pattern: '^[0-9a-f]{64}$' }),
    mediaType: Type.Union([Type.Literal('image/svg+xml'), Type.Literal('image/png')]),
    /** Read out in place of the mark; empty when the mark is decorative. */
    alt: Type.String({ maxLength: 200 }),
  },
  { additionalProperties: false },
)

/**
 * Where a public navigation link may point: somewhere on this site, or at an
 * absolute http(s) address.
 *
 * These links are rendered into the public site's header for every anonymous
 * reader, so the set of schemes is a whitelist rather than a blacklist. It
 * refuses `javascript:` and `data:` — script in a tenant's navigation bar is
 * stored XSS on a page nobody has to sign in to reach — and refuses
 * protocol-relative `//host`, which reads as a path and is not one.
 */
export const NAVIGATION_HREF_PATTERN = '^(?:/(?!/)[^\\s]*|https?://[^\\s]+)$'

/** One link beside the site name on the public site (ADR-028). */
const NavigationLinkSchema = Type.Object(
  {
    label: Type.String({ minLength: 1, maxLength: 60 }),
    href: Type.String({
      minLength: 1,
      maxLength: 2000,
      pattern: NAVIGATION_HREF_PATTERN,
    }),
  },
  { additionalProperties: false },
)

export const MAX_PUBLIC_NAVIGATION_LINKS = 8

export const OrganisationSettingsSchema = Type.Object(
  {
    version: Type.Literal(SETTINGS_VERSION),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    logo: Type.Optional(LogoSchema),
    /**
     * Identity, owned by the organisation and inherited by every workspace.
     *
     * The theme package's schema is used as it stands — so the file, the API
     * and the OpenAPI description all validate against exactly one definition
     * of a theme — with its static type stated rather than re-derived. The
     * theme document builds its many small unions by mapping arrays of
     * strings, which is enough to make `StaticDecode` of the whole document
     * collapse; `ThemeDocument` is the type that schema already publishes.
     */
    theme: Type.Unsafe<ThemeDocument>(ThemeDocumentSchema),
    layout: Type.Object(
      {
        default: LayoutSchema,
        /**
         * ADR-028 gives layout to the workspace "may be locked by the
         * organisation". Locked, `updateWorkspaceSettings` refuses.
         */
        locked: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    publicNavigation: Type.Array(NavigationLinkSchema, {
      maxItems: MAX_PUBLIC_NAVIGATION_LINKS,
    }),
    policies: Type.Object(
      {
        shareLinksAllowed: Type.Boolean(),
        publicPublishingAllowed: Type.Boolean(),
        /**
         * ADR-028: AA text contrast is the one doctor rule enforced by
         * default, and "an instance administrator can switch that enforcement
         * to advisory". This is that switch, and it is a policy rather than
         * part of the theme: it says how strictly *any* theme this
         * organisation saves is judged, and it outlives the theme it was set
         * beside. It changes what the doctor **reports** — `enforced` on the
         * rule, and `enforcedRulesHold` on the report — and never whether a
         * save is accepted, because the doctor advises and the theme editor
         * is where the advice is put to somebody who can act on it.
         */
        contrastEnforcement: Type.Union([Type.Literal('enforced'), Type.Literal('advisory')]),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

export type OrganisationSettings = Static<typeof OrganisationSettingsSchema>
export type NavigationLink = Static<typeof NavigationLinkSchema>
export type OrganisationLogo = Static<typeof LogoSchema>

export const WorkspaceSettingsSchema = Type.Object(
  {
    version: Type.Literal(SETTINGS_VERSION),
    /**
     * The workspace this file belongs to, written into the file as well as
     * into its name: a copied settings tree is then self-describing, and a
     * file under the wrong name is caught rather than silently applied.
     */
    workspaceId: Type.String({ minLength: 1 }),
    /** Absent means "inherit the organisation's default". */
    layout: Type.Optional(LayoutSchema),
  },
  { additionalProperties: false },
)

export type WorkspaceSettings = Static<typeof WorkspaceSettingsSchema>

export interface SettingsIssue {
  /** A JSON pointer into the document, `''` for the document itself. */
  readonly path: string
  readonly message: string
  readonly rule: string
}

export type SettingsValidation<T> =
  | { readonly valid: true; readonly document: T }
  | { readonly valid: false; readonly issues: readonly SettingsIssue[] }

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true })

const toIssue = (error: ErrorObject): SettingsIssue => ({
  path: error.instancePath,
  message: `${error.instancePath === '' ? 'the settings document' : error.instancePath} ${error.message}`,
  rule: error.keyword,
})

function validateWith<T>(validator: ValidateFunction, value: unknown): SettingsValidation<T> {
  if (validator(value)) return { valid: true, document: value as T }
  /* v8 ignore next -- ajv always sets `errors` on a failure; the fallback only keeps this total. */
  const errors = validator.errors ?? []
  return { valid: false, issues: errors.map(toIssue) }
}

const organisationValidator = ajv.compile(OrganisationSettingsSchema)
const workspaceValidator = ajv.compile(WorkspaceSettingsSchema)

/**
 * Validate an unknown value as organisation settings, reporting every problem
 * at once.
 *
 * The theme inside it is re-checked with the theme package's own validator,
 * because the JSON schema cannot express the two rules that matter there: a
 * curated face must be offered for the role it is used in, and an uploaded
 * face must fall back to a generic that suits it (ADR-028).
 */
export function validateOrganisationSettings(
  value: unknown,
): SettingsValidation<OrganisationSettings> {
  const structural = validateWith<OrganisationSettings>(organisationValidator, value)
  if (!structural.valid) return structural
  const theme = validateThemeDocument(structural.document.theme)
  return theme.valid
    ? structural
    : {
        valid: false,
        issues: theme.issues.map((issue) => ({ ...issue, path: `/theme${issue.path}` })),
      }
}

export function validateWorkspaceSettings(value: unknown): SettingsValidation<WorkspaceSettings> {
  return validateWith<WorkspaceSettings>(workspaceValidator, value)
}

const organisationReader = createVersionedReader<OrganisationSettings>({
  [SETTINGS_VERSION]: (value) => {
    const result = validateOrganisationSettings(value)
    return result.valid ? result.document : null
  },
})

const workspaceReader = createVersionedReader<WorkspaceSettings>({
  [SETTINGS_VERSION]: (value) => {
    const result = validateWorkspaceSettings(value)
    return result.valid ? result.document : null
  },
})

/** Organisation settings of any version this release can read, or null. */
export function parseOrganisationSettings(value: unknown): OrganisationSettings | null {
  return organisationReader.read(value)
}

export function parseWorkspaceSettings(value: unknown): WorkspaceSettings | null {
  return workspaceReader.read(value)
}

/**
 * What an instance starts with, before anybody has been through onboarding.
 *
 * The theme is the built-in default (ADR-028: Instrument, "because it fits the
 * first users best"), and the layout default is that theme's own recommended
 * variants, so an instance that never touches settings still looks like the
 * product it ships as.
 */
export function defaultOrganisationSettings(
  theme: ThemeDocument = DEFAULT_THEME,
): OrganisationSettings {
  return {
    version: SETTINGS_VERSION,
    name: BRAND.name,
    theme,
    layout: { default: recommendedLayout(theme), locked: false },
    publicNavigation: [],
    policies: {
      shareLinksAllowed: true,
      publicPublishingAllowed: false,
      contrastEnforcement: 'enforced',
    },
  }
}

/**
 * The layout a theme recommends (ADR-028's `recommendedLayout`).
 *
 * The theme document still spells this block `variants`, which is what every
 * built-in theme, the token map, and the web shell read today. Renaming it is
 * part of the same amendment and is deliberately not done here: this function
 * is the one place that reads a theme's recommendation as a layout, so the
 * rename is a change to this line rather than to every caller.
 */
export function recommendedLayout(theme: ThemeDocument): Layout {
  return theme.variants
}

export function defaultWorkspaceSettings(id: string): WorkspaceSettings {
  return { version: SETTINGS_VERSION, workspaceId: id }
}
