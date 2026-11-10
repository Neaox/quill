import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  configureWorkspaceSource,
  disconnectWorkspaceSource,
  getWorkspaceSource,
  previewWorkspaceSource,
  requestManualSourceSync,
} from '@quill/application'
import type { SourcePreview, SourcePreviewNode, WorkspaceSourceView } from '@quill/application'
import {
  MAX_FORGE_VIEW_TEMPLATE_LENGTH,
  MAX_SOURCE_MANIFEST_ENTRY_LENGTH,
  SOURCE_COMMIT_MESSAGE_SETTINGS,
  SOURCE_HISTORY_SETTINGS,
  SOURCE_OUTSIDE_LINK_SETTINGS,
} from '@quill/domain'
import type { FastifyPluginAsync } from 'fastify'

import {
  authorizerFor,
  requireInstanceAdmin,
  requireWorkspaceAccess,
} from '../application/authorization.ts'
import { resolveWorkspaceId } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'
import { conflict, notFound, unprocessable } from '../errors.ts'
import type { AppError } from '../errors.ts'
import { sessionRateLimit } from '../plugins/rate-limit.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'
import { IdParamsSchema } from './document-schemas.ts'

/**
 * A workspace's external source (ADR-061): where it reads from, how far it has
 * synced, and "Sync now".
 *
 * **Configuring a source is instance administration.** A source's credential
 * names a secret of the whole instance (ADR-034) and is sent to the remote the
 * source names, so whoever may configure one could send any secret to a
 * server of their choosing. Reading the source and asking for a sync need
 * only `manage` of the workspace, which ADR-061 leaves on in a sourced
 * workspace: neither sends anything anywhere new.
 *
 * **A preview is configuring's dry run**, so it is instance administration
 * too: it sends the credential a secret names to the address in the body. It
 * fetches the branch's head as a sync would, into a directory it removes,
 * and answers what saving would place where, writing nothing.
 */

/** "Sync now" presses a person may make in the rate limiter's window. */
const SYNC_REQUESTS_PER_WINDOW = 10

/** Previews a person may ask for in the rate limiter's window: each one fetches. */
const PREVIEW_REQUESTS_PER_WINDOW = 20

const SourceCollectionSchema = Type.Object({
  slug: Type.String({ minLength: 1, maxLength: 80 }),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  /** A directory or a file in the repository, relative to its root. */
  path: Type.String({ minLength: 1, maxLength: 1024 }),
})

const CredentialSchema = Type.Object({
  username: Type.String({ minLength: 1, maxLength: 256 }),
  /** The name of a secret in the secrets store, never its value (ADR-034). */
  secretName: Type.String({ minLength: 1, maxLength: 200 }),
})

const OutsideLinksSchema = Type.Union(
  SOURCE_OUTSIDE_LINK_SETTINGS.map((setting) => Type.Literal(setting)),
)

const ViewTemplateSchema = Type.Union([
  Type.String({ minLength: 1, maxLength: MAX_FORGE_VIEW_TEMPLATE_LENGTH }),
  Type.Null(),
])

const ManifestEntrySchema = Type.Union([
  Type.String({ minLength: 1, maxLength: MAX_SOURCE_MANIFEST_ENTRY_LENGTH }),
  Type.Null(),
])

/** Where a source reads from: what a preview opens, and the first half of configuring one. */
const SourceDraftFields = {
  remote: Type.String({ minLength: 1, maxLength: 2048 }),
  branch: Type.String({ minLength: 1, maxLength: 255 }),
  /**
   * The collections that place the files when the repository has no
   * manifest. None is allowed: a repository with a manifest needs none.
   */
  collections: Type.Array(SourceCollectionSchema, { maxItems: 100 }),
  credential: Type.Union([CredentialSchema, Type.Null()]),
  /**
   * Which workspace of a manifest that describes several to read, by its
   * slug; null or absent for the one whose slug is this workspace's.
   */
  manifestEntry: Type.Optional(ManifestEntrySchema),
}

const PreviewSourceBody = Type.Object(SourceDraftFields, { additionalProperties: false })

const ConfigureSourceBody = Type.Object(
  {
    ...SourceDraftFields,
    history: Type.Union(SOURCE_HISTORY_SETTINGS.map((setting) => Type.Literal(setting))),
    commitMessages: Type.Union(
      SOURCE_COMMIT_MESSAGE_SETTINGS.map((setting) => Type.Literal(setting)),
    ),
    /** Where a link to a repository file the source does not hold goes; `forge` when absent. */
    outsideLinks: Type.Optional(OutsideLinksSchema),
    /** The forge's address for a file at a commit; absent or null for the remote's host's own. */
    viewTemplate: Type.Optional(ViewTemplateSchema),
    /**
     * The name of the secret the source's push webhook is signed with (ADR-034),
     * never its value; null for no webhook, omitted to keep what the source has.
     */
    webhookSecret: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]),
    ),
  },
  { additionalProperties: false },
)

const SyncFailureSchema = Type.Object({
  reason: Type.String(),
  message: Type.String(),
  revision: Type.Union([Type.String(), Type.Null()]),
})

const RefusedFileSchema = Type.Object({
  path: Type.String(),
  revision: Type.String(),
  reason: Type.String(),
})

const BrokenLinkSchema = Type.Object({
  /** The document's path in the repository. */
  path: Type.String(),
  /** The link's destination as written. */
  url: Type.String(),
  /** The revision at which the path it names was not in the repository. */
  revision: Type.String(),
})

const WorkspaceSourceSchema = Type.Object({
  remote: Type.String(),
  branch: Type.String(),
  collections: Type.Array(
    Type.Object({
      collectionId: Type.String(),
      slug: Type.String(),
      name: Type.String(),
      path: Type.String(),
    }),
  ),
  history: Type.String(),
  commitMessages: Type.String(),
  /** The manifest entry it reads; null for the one whose slug is the workspace's. */
  manifestEntry: Type.Union([Type.String(), Type.Null()]),
  credential: Type.Union([CredentialSchema, Type.Null()]),
  outsideLinks: Type.String(),
  viewTemplate: Type.Union([Type.String(), Type.Null()]),
  /** The name of the secret its push webhook is signed with; null when it takes no webhook. */
  webhookSecret: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.String({ format: 'date-time' }),
  /**
   * When the workspace stopped reading from this repository; null while it
   * reads. A disconnected source is a read-only record of where it came from.
   */
  disconnectedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  /** How far it has synced; null before the first attempt. */
  sync: Type.Union([
    Type.Object({
      lastSyncedRevision: Type.Union([Type.String(), Type.Null()]),
      lastSyncedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
      lastAttemptAt: Type.String({ format: 'date-time' }),
      failure: Type.Union([SyncFailureSchema, Type.Null()]),
      refused: Type.Array(RefusedFileSchema),
      /** Relative links to paths not in the repository; null until a sync has checked them. */
      brokenLinks: Type.Union([Type.Array(BrokenLinkSchema), Type.Null()]),
      /** Keys the manifest has that this release does not read, with their lines. */
      unknownKeys: Type.Array(
        Type.Object({ key: Type.String(), line: Type.Union([Type.Integer(), Type.Null()]) }),
      ),
    }),
    Type.Null(),
  ]),
  /** A sync of the source is running now, in any process. */
  syncing: Type.Boolean(),
})

const SyncRequestedSchema = Type.Object({ requested: Type.Boolean() })

const ManifestProblemSchema = Type.Object({
  line: Type.Union([Type.Integer(), Type.Null()]),
  message: Type.String(),
})

/** One document of a collection's tree, in reading order; `depth` says where it nests. */
const PreviewNodeSchema = Type.Object({
  path: Type.String(),
  title: Type.String(),
  kind: Type.Union([
    Type.Literal('document'),
    Type.Literal('folder'),
    Type.Literal('generated-folder'),
  ]),
  /** What saving does to it; null for a workspace not yet read from a repository. */
  change: Type.Union([
    Type.Literal('added'),
    Type.Literal('moved'),
    Type.Literal('unchanged'),
    Type.Null(),
  ]),
  depth: Type.Integer({ minimum: 0 }),
})

const SourcePreviewSchema = Type.Object({
  /** The head the preview read. */
  revision: Type.String(),
  manifest: Type.Object({
    path: Type.String(),
    state: Type.Union([Type.Literal('absent'), Type.Literal('read'), Type.Literal('problem')]),
    problem: Type.Union([ManifestProblemSchema, Type.Null()]),
    /** The workspaces it describes; a manifest of top-level collections has one with no slug. */
    entries: Type.Array(
      Type.Object({ slug: Type.Union([Type.String(), Type.Null()]), collections: Type.Integer() }),
    ),
    entry: Type.Union([Type.String(), Type.Null()]),
    unknownKeys: Type.Array(
      Type.Object({ key: Type.String(), line: Type.Union([Type.Integer(), Type.Null()]) }),
    ),
  }),
  origin: Type.Union([Type.Literal('manifest'), Type.Literal('settings'), Type.Null()]),
  collections: Type.Array(
    Type.Object({
      slug: Type.String(),
      title: Type.String(),
      path: Type.String(),
      order: Type.String(),
      status: Type.Union([Type.Literal('new'), Type.Literal('kept'), Type.Literal('renamed')]),
      previousTitle: Type.Union([Type.String(), Type.Null()]),
      documents: Type.Integer(),
      nodes: Type.Array(PreviewNodeSchema),
    }),
  ),
  skipped: Type.Array(
    Type.Object({
      reason: Type.Union([
        Type.Literal('excluded'),
        Type.Literal('outside'),
        Type.Literal('too-large'),
        Type.Literal('not-utf8'),
        Type.Literal('symbolic-link'),
        Type.Literal('not-markdown'),
      ]),
      count: Type.Integer(),
      paths: Type.Array(Type.String()),
      /** For `excluded`: the manifest's pattern that left each listed path out. */
      patterns: Type.Record(Type.String(), Type.String()),
    }),
  ),
  /** Repository assets the sync would import as attachments. */
  assets: Type.Integer(),
  limits: Type.Object({
    files: Type.Integer(),
    truncated: Type.Boolean(),
    unread: Type.Integer(),
  }),
  /** What saving does to a workspace already read from a repository; null otherwise. */
  changes: Type.Union([
    Type.Object({
      added: Type.Integer(),
      moved: Type.Integer(),
      unchanged: Type.Integer(),
      archived: Type.Array(Type.Object({ path: Type.String(), title: Type.String() })),
      retired: Type.Array(Type.Object({ slug: Type.String(), title: Type.String() })),
    }),
    Type.Null(),
  ]),
})

/**
 * A preview, or why the repository could not be read. A repository that does
 * not answer is an answer here, not an error: the form shows it beside the
 * address, branch or credential it is about.
 */
const PreviewResponseSchema = Type.Union([
  Type.Object({ outcome: Type.Literal('preview'), preview: SourcePreviewSchema }),
  Type.Object({
    outcome: Type.Literal('unreadable'),
    /** An `ExternalSourceFailure`, or `credential-refused` or `unreachable`. */
    reason: Type.String(),
    /** What Git said, with any credential removed. */
    message: Type.String(),
  }),
])

type PreviewResponse = Static<typeof SourcePreviewSchema>
type PreviewNodes = PreviewResponse['collections'][number]['nodes']

/** A collection's tree, flattened in reading order with each node's depth. */
function flatten(nodes: readonly SourcePreviewNode[], depth = 0): PreviewNodes {
  return nodes.flatMap(({ children, ...node }) => [
    { ...node, depth },
    ...flatten(children, depth + 1),
  ])
}

function previewResponse(preview: SourcePreview): PreviewResponse {
  return {
    ...preview,
    manifest: {
      ...preview.manifest,
      entries: [...preview.manifest.entries],
      unknownKeys: [...preview.manifest.unknownKeys],
    },
    collections: preview.collections.map(({ tree, ...collection }) => ({
      ...collection,
      nodes: flatten(tree),
    })),
    skipped: preview.skipped.map((skipped) => ({
      ...skipped,
      paths: [...skipped.paths],
      patterns: { ...skipped.patterns },
    })),
    changes:
      preview.changes === null
        ? null
        : {
            ...preview.changes,
            archived: [...preview.changes.archived],
            retired: [...preview.changes.retired],
          },
  }
}

type WorkspaceSourceResponse = Static<typeof WorkspaceSourceSchema>

function sourceResponse(
  { source, collections, state }: WorkspaceSourceView,
  syncing: boolean,
): WorkspaceSourceResponse {
  return {
    remote: source.remote,
    branch: source.branch,
    collections: collections.map(({ collectionId, slug, name, path }) => ({
      collectionId,
      slug,
      name,
      path,
    })),
    history: source.history,
    commitMessages: source.commitMessages,
    manifestEntry: source.manifestEntry,
    credential: source.credential,
    outsideLinks: source.outsideLinks,
    viewTemplate: source.viewTemplate,
    webhookSecret: source.webhookSecretName,
    updatedAt: source.updatedAt.toISOString(),
    disconnectedAt: source.disconnectedAt?.toISOString() ?? null,
    sync:
      state === null
        ? null
        : {
            lastSyncedRevision: state.lastSyncedRevision,
            lastSyncedAt: state.lastSyncedAt?.toISOString() ?? null,
            lastAttemptAt: state.lastAttemptAt.toISOString(),
            failure: state.failure,
            refused: [...state.refused],
            brokenLinks: state.brokenLinks === null ? null : [...state.brokenLinks],
            unknownKeys: [...(state.layout?.unknownKeys ?? [])],
          },
    syncing,
  }
}

const notSourced = (): AppError =>
  conflict('workspace_not_sourced', 'This workspace does not read from a repository')

const wasDisconnected = (): AppError =>
  conflict(
    'workspace_source_disconnected',
    'This workspace was disconnected from its repository, and holds documents people may have edited, which a sync would strand. Connect a new workspace to the repository instead.',
  )

const notEmpty = (): AppError =>
  conflict(
    'workspace_not_empty',
    'Only a workspace with no documents can be made to read from a repository',
  )

export function workspaceSourceRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    app.get(
      '/api/workspaces/:id/source',
      {
        preHandler: app.requireSession,
        schema: { params: IdParamsSchema, response: { 200: WorkspaceSourceSchema } },
      },
      async (request) => {
        const target = await resolveWorkspaceId(deps, request.params.id)
        await requireWorkspaceAccess(authorizerFor(deps, request), target, 'manage')
        const view = await getWorkspaceSource(deps, target)
        if (view === null) throw notSourced()
        return sourceResponse(view, await deps.sourceSync.lock.isHeld(target))
      },
    )

    app.put(
      '/api/workspaces/:id/source',
      {
        preHandler: app.requireVerifiedSession,
        schema: {
          params: IdParamsSchema,
          body: ConfigureSourceBody,
          response: { 200: WorkspaceSourceSchema },
        },
      },
      async (request) => {
        // Before the workspace is resolved, so nobody else learns which exist.
        await requireInstanceAdmin(deps, request)
        const target = await resolveWorkspaceId(deps, request.params.id)
        const session = requireAuthenticatedSession(request)
        const { webhookSecret, ...settings } = request.body
        const result = await configureWorkspaceSource(
          { ...deps, allowFileRemotes: deps.sourceSync.allowFileRemotesForTesting },
          {
            ...settings,
            webhookSecretName: webhookSecret,
            workspaceId: target,
            configuredBy: session.userId,
          },
        )
        switch (result.kind) {
          case 'configured':
            return sourceResponse(result.view, await deps.sourceSync.lock.isHeld(target))
          /* v8 ignore next 2 -- the workspace was resolved a moment ago. */
          case 'not-found':
            throw notFound('Workspace not found')
          case 'not-empty':
            throw notEmpty()
          case 'disconnected':
            throw wasDisconnected()
          case 'invalid':
            throw unprocessable('invalid_source', result.message, { field: result.field })
        }
      },
    )

    app.post(
      '/api/workspaces/:id/source/preview',
      {
        preHandler: app.requireVerifiedSession,
        config: sessionRateLimit('source-preview', PREVIEW_REQUESTS_PER_WINDOW),
        schema: {
          params: IdParamsSchema,
          body: PreviewSourceBody,
          response: { 200: PreviewResponseSchema },
        },
      },
      async (request) => {
        // Before the workspace is resolved, as configuring is.
        await requireInstanceAdmin(deps, request)
        const target = await resolveWorkspaceId(deps, request.params.id)
        const result = await previewWorkspaceSource(
          {
            uow: deps.uow,
            sources: deps.sourceSync.sources,
            format: deps.format,
            allowFileRemotes: deps.sourceSync.allowFileRemotesForTesting,
          },
          { ...request.body, workspaceId: target },
        )
        switch (result.kind) {
          case 'preview':
            return { outcome: 'preview' as const, preview: previewResponse(result.preview) }
          case 'unreadable':
            return {
              outcome: 'unreadable' as const,
              reason: result.reason,
              message: result.message,
            }
          /* v8 ignore next 2 -- the workspace was resolved a moment ago. */
          case 'not-found':
            throw notFound('Workspace not found')
          case 'not-empty':
            throw notEmpty()
          case 'disconnected':
            throw wasDisconnected()
          case 'invalid':
            throw unprocessable('invalid_source', result.message, { field: result.field })
        }
      },
    )

    app.post(
      '/api/workspaces/:id/source/disconnect',
      {
        preHandler: app.requireVerifiedSession,
        schema: { params: IdParamsSchema, response: { 200: WorkspaceSourceSchema } },
      },
      async (request) => {
        // Instance administration, as connecting is; checked before the workspace is resolved.
        await requireInstanceAdmin(deps, request)
        const target = await resolveWorkspaceId(deps, request.params.id)
        const session = requireAuthenticatedSession(request)
        const result = await disconnectWorkspaceSource(
          { ...deps, lock: deps.sourceSync.lock },
          { workspaceId: target, disconnectedBy: session.userId },
        )
        switch (result.kind) {
          case 'disconnected':
            return sourceResponse(result.view, false)
          /* v8 ignore next 2 -- the workspace was resolved a moment ago. */
          case 'not-found':
            throw notFound('Workspace not found')
          case 'not-sourced':
            throw notSourced()
          case 'busy':
            throw conflict(
              'source_sync_running',
              'A sync of this repository is running. Disconnect once it has finished.',
            )
        }
      },
    )

    app.post(
      '/api/workspaces/:id/source/sync',
      {
        preHandler: app.requireVerifiedSession,
        config: sessionRateLimit('source-sync', SYNC_REQUESTS_PER_WINDOW),
        schema: { params: IdParamsSchema, response: { 202: SyncRequestedSchema } },
      },
      async (request, reply) => {
        const target = await resolveWorkspaceId(deps, request.params.id)
        await requireWorkspaceAccess(authorizerFor(deps, request), target, 'manage')
        const session = requireAuthenticatedSession(request)
        const result = await requestManualSourceSync(deps, {
          workspaceId: target,
          requestedBy: session.userId,
        })
        if (result.kind === 'not-sourced') throw notSourced()
        // Accepted, not done: the sync runs on the job runner, off this request.
        reply.status(202)
        return { requested: true }
      },
    )
  }
}
