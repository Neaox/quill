import { Ajv } from 'ajv'
import { Type } from '@sinclair/typebox'
import type { Static, TSchema } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  deleteSecret,
  describeSecret,
  listSecretNames,
  readEffectiveSettings,
  readOrganisationSettings,
  readWorkspaceSettings,
  setSecret,
  updateOrganisationSettings,
  updateWorkspaceSettings,
} from '@quill/application'
import type { ContentAuthor, SecretSummary } from '@quill/application'
import type { RevisionId } from '@quill/domain'
import type { FastifyPluginAsync, FastifyRequest, FastifySchemaCompiler } from 'fastify'

import {
  isInstanceAdmin,
  requireInstanceAdmin,
  requireWorkspaceAccess,
} from '../application/authorization.ts'
import { authorizerFor } from '../application/authorization.ts'
import { resolveWorkspaceId } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'
import { AppError, conflict, notFound, unprocessable } from '../errors.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'
import {
  OrganisationSettingsDocumentSchema,
  OrganisationSettingsResponseSchema,
  SecretSchema,
  SetSecretBodySchema,
  themeReportResponse,
  UpdateOrganisationSettingsBodySchema,
  UpdatedOrganisationSettingsSchema,
  UpdateWorkspaceSettingsBodySchema,
  UpdatedWorkspaceSettingsSchema,
  WorkspaceSettingsResponseSchema,
} from './settings-schemas.ts'

/**
 * Settings and secrets (ADR-034, ADR-028).
 *
 * Who may do what follows ADR-028's "who decides what" table. The
 * organisation's settings carry the theme, the public navigation and the
 * policies, so **reading** them needs only a session — every screen renders
 * with them — while **changing** them is instance administration. A
 * workspace's own settings need `view` to read and `manage` to change, like
 * everything else about a workspace.
 *
 * Secrets are instance administration throughout, and no route in this file
 * can answer with a secret's value: the response schema has no field for one
 * (`settings-schemas.ts`).
 */
export function settingsRoutes(deps: AppDependencies): FastifyPluginAsync {
  const requireAdmin = (request: FastifyRequest): Promise<void> =>
    requireInstanceAdmin(deps, request)

  /** The author on the revision: the person, as the content store records them. */
  const author = async (request: FastifyRequest): Promise<ContentAuthor> => {
    const session = requireAuthenticatedSession(request)
    const user = await deps.uow.repos.users.findById(session.userId)
    /* v8 ignore next -- sessions cascade with their user, so a valid session always has one. */
    if (user === null) throw notFound('Signed-in user no longer exists')
    return { name: user.displayName, email: user.email }
  }

  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()
    app.addSchema(OrganisationSettingsDocumentSchema)
    app.addSchema(SecretSchema)
    app.setValidatorCompiler(strictValidator())

    app.get(
      '/api/settings/organisation',
      {
        preHandler: app.requireSession,
        schema: { response: { 200: OrganisationSettingsResponseSchema } },
      },
      async (request) => {
        const result = await readOrganisationSettings(deps)
        if (result.kind === 'unreadable') throw await unreadableFor(deps, request, result)
        return { revision: result.revision, settings: result.document }
      },
    )

    app.put(
      '/api/settings/organisation',
      {
        preHandler: app.requireVerifiedSession,
        schema: {
          body: UpdateOrganisationSettingsBodySchema,
          response: { 200: UpdatedOrganisationSettingsSchema },
        },
      },
      async (request) => {
        await requireAdmin(request)
        const session = requireAuthenticatedSession(request)
        const result = await updateOrganisationSettings(deps, {
          document: request.body.settings,
          expectedRevision: request.body.expectedRevision as RevisionId | null,
          actor: session.userId,
          author: await author(request),
          ...(request.body.changeNote === undefined ? {} : { changeNote: request.body.changeNote }),
        })
        if (result.kind === 'invalid') throw invalid(result.issues)
        if (result.kind === 'conflict') throw settingsConflict(result.current.revision)
        // The organisation's name, theme, navigation and policies are on every
        // public page, and the public site holds finished pages between
        // requests — including, in the case of the publishing policy, whether
        // there is a site there at all (ADR-023).
        deps.publicSiteCache.invalidate()
        return {
          revision: result.revision,
          settings: result.document,
          report: themeReportResponse(result.report),
        }
      },
    )

    app.get(
      '/api/workspaces/:id/settings',
      {
        preHandler: app.requireSession,
        schema: {
          params: Type.Object({ id: Type.String() }),
          response: { 200: WorkspaceSettingsResponseSchema },
        },
      },
      async (request) => {
        const workspaceId = await resolveWorkspaceId(deps, request.params.id)
        await requireWorkspaceAccess(authorizerFor(deps, request), workspaceId, 'view')
        const settings = await readWorkspaceSettings(deps, workspaceId)
        if (settings.kind === 'unreadable') throw await unreadableFor(deps, request, settings)
        const effective = await readEffectiveSettings(deps, workspaceId)
        if (effective.kind === 'unreadable') throw await unreadableFor(deps, request, effective)
        return {
          revision: settings.revision,
          settings: settings.document,
          effective: {
            layout: effective.effective.layout,
            layoutSource: effective.effective.layoutSource,
            layoutLocked: effective.effective.layoutLocked,
          },
        }
      },
    )

    app.put(
      '/api/workspaces/:id/settings',
      {
        preHandler: app.requireVerifiedSession,
        schema: {
          params: Type.Object({ id: Type.String() }),
          body: UpdateWorkspaceSettingsBodySchema,
          response: { 200: UpdatedWorkspaceSettingsSchema },
        },
      },
      async (request) => {
        const workspaceId = await resolveWorkspaceId(deps, request.params.id)
        await requireWorkspaceAccess(authorizerFor(deps, request), workspaceId, 'manage')
        const session = requireAuthenticatedSession(request)
        const result = await updateWorkspaceSettings(deps, workspaceId, {
          document: request.body.settings,
          expectedRevision: request.body.expectedRevision as RevisionId | null,
          actor: session.userId,
          author: await author(request),
          ...(request.body.changeNote === undefined ? {} : { changeNote: request.body.changeNote }),
        })
        switch (result.kind) {
          case 'invalid':
            throw invalid(result.issues)
          case 'conflict':
            throw settingsConflict(result.current.revision)
          case 'layout-locked':
            throw conflict(
              'workspace_layout_locked',
              'This organisation decides the layout for every workspace',
            )
          case 'organisation-unreadable':
            throw await unreadableFor(deps, request, result)
          case 'updated':
            return { revision: result.revision, settings: result.document }
        }
      },
    )

    // -----------------------------------------------------------------------
    // Secrets. Instance administration, and never a value in a response.
    // -----------------------------------------------------------------------

    app.get(
      '/api/settings/secrets',
      {
        preHandler: app.requireSession,
        schema: { response: { 200: Type.Array(Type.Ref(SecretSchema)) } },
      },
      async (request) => {
        await requireAdmin(request)
        return (await listSecretNames(deps)).map(secretResponse)
      },
    )

    app.get(
      '/api/settings/secrets/:name',
      {
        preHandler: app.requireSession,
        schema: {
          params: Type.Object({ name: Type.String() }),
          response: { 200: Type.Ref(SecretSchema) },
        },
      },
      async (request) => {
        await requireAdmin(request)
        const result = await describeSecret(deps, request.params.name)
        if (result.kind === 'not-found') throw notFound('No secret is stored under that name')
        return secretResponse(result.secret)
      },
    )

    app.put(
      '/api/settings/secrets/:name',
      {
        preHandler: app.requireVerifiedSession,
        schema: {
          params: Type.Object({ name: Type.String() }),
          body: SetSecretBodySchema,
          response: { 200: Type.Ref(SecretSchema) },
        },
      },
      async (request) => {
        await requireAdmin(request)
        const session = requireAuthenticatedSession(request)
        const result = await setSecret(deps, {
          name: request.params.name,
          value: request.body.value,
          actor: session.userId,
        })
        if (result.kind === 'invalid-name') {
          throw unprocessable(
            'invalid_secret_name',
            'A secret name is lower-case and path-like, such as "oidc/entra/client-secret"',
          )
        }
        if (result.kind === 'invalid-value') {
          throw unprocessable('invalid_secret_value', `That value is ${result.reason}`)
        }
        return secretResponse(result.secret)
      },
    )

    app.delete(
      '/api/settings/secrets/:name',
      {
        preHandler: app.requireVerifiedSession,
        schema: { params: Type.Object({ name: Type.String() }) },
      },
      async (request, reply) => {
        await requireAdmin(request)
        const session = requireAuthenticatedSession(request)
        const result = await deleteSecret(deps, request.params.name, session.userId)
        if (result.kind === 'not-found') throw notFound('No secret is stored under that name')
        reply.status(204)
      },
    )
  }
}

/**
 * Ajv for these routes, and only these.
 *
 * Fastify's default validator is built for forgiveness: it coerces `"1"` to
 * `1` and *removes* a property the schema does not declare rather than
 * refusing it. Neither is right for a settings document. Coercion would let a
 * policy arrive as the string `"false"` and be written into the file as a
 * boolean somebody never chose, and silent removal would answer `200` to a
 * request that asked for something this release does not understand — the
 * exact shape of a client written against a newer version, which should be
 * told rather than quietly given a different result.
 *
 * Set inside this plugin, so it encapsulates: every other route keeps the
 * behaviour it was written against.
 */
function strictValidator(): FastifySchemaCompiler<TSchema> {
  const ajv = new Ajv({
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
    allErrors: false,
    strict: false,
  })
  // The one schema the bodies reach by `$ref`. The others are inline.
  ajv.addSchema(OrganisationSettingsDocumentSchema)
  return ({ schema }) => ajv.compile(schema)
}

function secretResponse(secret: SecretSummary): Static<typeof SecretSchema> {
  return {
    name: secret.name,
    keyId: secret.keyId,
    createdAt: secret.createdAt.toISOString(),
    rotatedAt: secret.rotatedAt?.toISOString() ?? null,
    rewrappedAt: secret.rewrappedAt?.toISOString() ?? null,
  }
}

/**
 * A settings file this release cannot read.
 *
 * The parser's own message — "no reader understands version 7", "line 4:
 * unexpected character" — goes to the log and never into the response: it
 * describes a file the caller did not write and, in the YAML case, quotes
 * from it. What the response carries instead is the **revision**, and only
 * for an instance administrator, because that is the one thing needed to act:
 * it is the `expectedRevision` of the `PUT` that overwrites the file, and
 * the revision to read the history at.
 */
async function unreadableFor(
  deps: AppDependencies,
  request: FastifyRequest,
  outcome: { readonly reason: string; readonly revision?: RevisionId },
): Promise<AppError> {
  request.log.error(
    { revision: outcome.revision, reason: outcome.reason },
    'A settings file in the system workspace cannot be read by this release',
  )
  const forAdmin = await isInstanceAdmin(deps, request)
  return new AppError(
    500,
    'settings_unreadable',
    'This instance cannot read its own settings file. An instance administrator can overwrite ' +
      'it, or restore an earlier revision of it.',
    forAdmin && outcome.revision !== undefined ? { revision: outcome.revision } : undefined,
  )
}

function invalid(issues: readonly { path: string; message: string; rule: string }[]): AppError {
  return unprocessable('invalid_settings', 'These settings are not valid', { issues })
}

function settingsConflict(revision: RevisionId | null): AppError {
  return conflict(
    'settings_conflict',
    'Somebody else changed these settings while you were editing them',
    { revision },
  )
}
