import {
  SOURCE_COMMIT_MESSAGE_SETTINGS,
  SOURCE_HISTORY_SETTINGS,
  SOURCE_OUTSIDE_LINK_SETTINGS,
  checkForgeViewTemplate,
  checkSourceBranch,
  checkSourcePath,
  checkSourceRemote,
  checkSourceUsername,
  collectionId,
  slugify,
} from '@quill/domain'
import type {
  SourceCommitMessageSetting,
  SourceHistorySetting,
  SourceOutsideLinkSetting,
  UserId,
  WorkspaceId,
} from '@quill/domain'

import type { CollectionRow, RepositoryBundle, UnitOfWork } from '../ports/persistence.ts'
import type {
  SourceCollection,
  SourceSyncStateRow,
  WorkspaceSourceCredential,
  WorkspaceSourceRow,
} from '../ports/source-sync.ts'
import type { Clock, IdGenerator } from '../ports/system.ts'
import { sourceSyncRequested } from './events.ts'
import { isSecretName } from './secrets.ts'

/**
 * Configuring where a sourced workspace reads from, and asking it to sync
 * (ADR-061, "A source is configured on a workspace" and "Freshness").
 *
 * The settings name collections of their own: each by a slug, a name and the
 * path in the repository it reads. They place the source's files wherever
 * the source has no manifest (`.quill/workspace.yaml`); where it has one, the
 * manifest decides, and a collection the settings name that the manifest
 * does not stays, empty, because it is the administrator's. A collection
 * keeps its identity by its slug, as the manifest's do: a new slug creates a
 * collection, and a new name for a known slug renames it.
 *
 * Four rules are worth stating:
 *
 * - **Only an empty workspace becomes sourced.** A sourced workspace's sync
 *   job is its only writer, and documents written in Quill would be stranded
 *   in it, unwritable and outside the source. A workspace that is already
 *   sourced may change its settings.
 * - **A credential names a secret, never holds one** (ADR-034). The secret
 *   must exist when the source is configured, so a typing mistake is caught
 *   here rather than at the first fetch; its value is read at each fetch.
 * - **Configuring asks for a sync**, in the same transaction, so the first
 *   sync needs no second step.
 * - **Every setting may change after a sync.** The sync job compares the
 *   layout it last placed the tree by with the one it reads now, and a new
 *   one re-plans the whole tree: a path added brings in every file under
 *   it, and a path taken away archives what it held.
 */

export const WORKSPACE_SOURCE_AUDIT_EVENTS = {
  configured: 'workspace.source_configured',
  syncRequested: 'workspace.source_sync_requested',
} as const

/** More collections than this is a manifest's job, not a settings form's. */
export const MAX_SOURCE_COLLECTIONS = 100
export const MAX_SOURCE_COLLECTION_NAME_LENGTH = 200

export interface WorkspaceSourceDependencies {
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly ids: IdGenerator
  /** Accept `file://` remotes. Tests only, never from configuration an operator sets. */
  readonly allowFileRemotes?: boolean
}

export interface SourceCollectionInput {
  readonly slug: string
  readonly name: string
  /** A directory or a file in the repository. */
  readonly path: string
}

export interface ConfigureWorkspaceSourceCommand {
  readonly workspaceId: WorkspaceId
  readonly remote: string
  readonly branch: string
  readonly collections: readonly SourceCollectionInput[]
  readonly history: SourceHistorySetting
  readonly commitMessages: SourceCommitMessageSetting
  readonly credential: WorkspaceSourceCredential | null
  /**
   * Where a link to a repository file the source does not hold goes
   * (ADR-061): `forge` (the default) or `text`.
   */
  readonly outsideLinks?: SourceOutsideLinkSetting | undefined
  /**
   * The forge's address for a file at a commit, with `{commit}` and
   * `{path}`; absent or null to use the one known for the remote's host.
   */
  readonly viewTemplate?: string | null | undefined
  readonly configuredBy: UserId
}

/** The setting a refusal is about, so a form can put the message beside it. */
export type WorkspaceSourceField =
  | 'remote'
  | 'branch'
  | 'collections'
  | 'history'
  | 'commitMessages'
  | 'credential'
  | 'outsideLinks'
  | 'viewTemplate'

export interface WorkspaceSourceView {
  readonly source: WorkspaceSourceRow
  /** The collections the source fills, with their names and slugs, in the order configured. */
  readonly collections: readonly (SourceCollection & {
    readonly slug: string
    readonly name: string
  })[]
  /** How far it has synced; null before the first attempt. */
  readonly state: SourceSyncStateRow | null
}

export type ConfigureWorkspaceSourceResult =
  | { readonly kind: 'configured'; readonly view: WorkspaceSourceView }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'not-empty' }
  | {
      readonly kind: 'invalid'
      readonly field: WorkspaceSourceField
      readonly message: string
    }

interface ValidSettings {
  readonly remote: string
  readonly branch: string
  readonly collections: readonly SourceCollectionInput[]
  readonly outsideLinks: SourceOutsideLinkSetting
  readonly viewTemplate: string | null
}

type Invalid = Extract<ConfigureWorkspaceSourceResult, { kind: 'invalid' }>

const invalid = (field: WorkspaceSourceField, message: string): Invalid => ({
  kind: 'invalid',
  field,
  message,
})

export async function configureWorkspaceSource(
  deps: WorkspaceSourceDependencies,
  command: ConfigureWorkspaceSourceCommand,
): Promise<ConfigureWorkspaceSourceResult> {
  const { repos } = deps.uow
  const workspace = await repos.workspaces.findById(command.workspaceId)
  if (workspace === null) return { kind: 'not-found' }

  const valid = await validate(deps, command)
  if ('kind' in valid) return valid

  if (workspace.origin.kind === 'native') {
    const documents = await repos.documents.listByWorkspace(command.workspaceId)
    if (documents.length > 0) return { kind: 'not-empty' }
  }

  const now = deps.clock.now()
  const view = await deps.uow.run(async (tx) => {
    const collections = await placeCollections(deps, tx, command.workspaceId, valid.collections)
    const source = await tx.workspaceSources.put({
      workspaceId: command.workspaceId,
      remote: valid.remote,
      branch: valid.branch,
      collections: collections.map(({ collectionId: id, path }) => ({ collectionId: id, path })),
      history: command.history,
      commitMessages: command.commitMessages,
      credential: command.credential,
      outsideLinks: valid.outsideLinks,
      viewTemplate: valid.viewTemplate,
      configuredBy: command.configuredBy,
      now,
    })
    await tx.events.record(
      sourceSyncRequested,
      { workspaceId: command.workspaceId, trigger: 'manual' },
      now,
    )
    await tx.audit.write({
      id: deps.ids.uuid(),
      type: WORKSPACE_SOURCE_AUDIT_EVENTS.configured,
      actorUserId: command.configuredBy,
      targetType: 'workspace',
      targetId: command.workspaceId,
      // Where it reads from and the name of the secret, never the secret.
      metadata: {
        remote: source.remote,
        branch: source.branch,
        paths: source.collections.map(({ path }) => path),
        history: source.history,
        commitMessages: source.commitMessages,
        credentialSecret: source.credential?.secretName ?? null,
        outsideLinks: source.outsideLinks,
        viewTemplate: source.viewTemplate,
      },
      now,
    })
    return { source, collections, state: await tx.sourceSyncState.find(command.workspaceId) }
  })
  return { kind: 'configured', view }
}

async function validate(
  deps: WorkspaceSourceDependencies,
  command: ConfigureWorkspaceSourceCommand,
): Promise<ValidSettings | Invalid> {
  const remote = checkSourceRemote(command.remote, {
    allowFileRemotes: deps.allowFileRemotes === true,
  })
  if (!remote.ok) return invalid('remote', remote.error)
  const branch = checkSourceBranch(command.branch)
  if (!branch.ok) return invalid('branch', branch.error)
  if (!SOURCE_HISTORY_SETTINGS.includes(command.history)) {
    return invalid('history', `The history setting must be one of ${SOURCE_HISTORY_SETTINGS}.`)
  }
  if (!SOURCE_COMMIT_MESSAGE_SETTINGS.includes(command.commitMessages)) {
    return invalid(
      'commitMessages',
      `The commit message setting must be one of ${SOURCE_COMMIT_MESSAGE_SETTINGS}.`,
    )
  }
  const outsideLinks = command.outsideLinks ?? 'forge'
  if (!SOURCE_OUTSIDE_LINK_SETTINGS.includes(outsideLinks)) {
    return invalid(
      'outsideLinks',
      `The setting for links outside the source must be one of ${SOURCE_OUTSIDE_LINK_SETTINGS}.`,
    )
  }
  const template = command.viewTemplate ?? null
  const viewTemplate = template === null ? null : checkForgeViewTemplate(template)
  if (viewTemplate?.ok === false) return invalid('viewTemplate', viewTemplate.error)
  const collections = validateCollections(command.collections)
  if ('kind' in collections) return collections
  const credential = await validateCredential(deps, command.credential)
  if (credential !== null) return credential
  return {
    remote: remote.value,
    branch: branch.value,
    collections,
    outsideLinks,
    viewTemplate: viewTemplate?.value ?? null,
  }
}

function validateCollections(
  inputs: readonly SourceCollectionInput[],
): readonly SourceCollectionInput[] | Invalid {
  if (inputs.length === 0) return invalid('collections', 'A source needs at least one collection.')
  if (inputs.length > MAX_SOURCE_COLLECTIONS) {
    return invalid(
      'collections',
      `A source can fill at most ${MAX_SOURCE_COLLECTIONS} collections.`,
    )
  }
  const slugs = new Set<string>()
  const paths = new Set<string>()
  const collections: SourceCollectionInput[] = []
  for (const input of inputs) {
    const name = input.name.trim()
    if (name.length === 0 || name.length > MAX_SOURCE_COLLECTION_NAME_LENGTH) {
      return invalid(
        'collections',
        `A collection's name must be 1 to ${MAX_SOURCE_COLLECTION_NAME_LENGTH} characters.`,
      )
    }
    if (input.slug.length === 0 || slugify(input.slug) !== input.slug) {
      return invalid('collections', `"${input.slug}" is not a slug; try "${slugify(input.name)}".`)
    }
    const path = checkSourcePath(input.path)
    if (!path.ok) return invalid('collections', path.error)
    if (slugs.has(input.slug)) {
      return invalid('collections', `Two collections have the slug "${input.slug}".`)
    }
    if (paths.has(path.value)) {
      return invalid('collections', `Two collections read "${path.value}".`)
    }
    slugs.add(input.slug)
    paths.add(path.value)
    collections.push({ slug: input.slug, name, path: path.value })
  }
  return collections
}

async function validateCredential(
  deps: WorkspaceSourceDependencies,
  credential: WorkspaceSourceCredential | null,
): Promise<Invalid | null> {
  if (credential === null) return null
  const username = checkSourceUsername(credential.username)
  if (!username.ok) return invalid('credential', username.error)
  if (!isSecretName(credential.secretName)) {
    return invalid('credential', `"${credential.secretName}" is not a secret name.`)
  }
  // Whether it is there, without opening it: the value is read at each fetch.
  if ((await deps.uow.repos.secrets.find(credential.secretName)) === null) {
    return invalid('credential', `No secret is stored as "${credential.secretName}".`)
  }
  return null
}

/** Each configured collection's row: found by slug, renamed to its new name, or created. */
async function placeCollections(
  deps: WorkspaceSourceDependencies,
  tx: RepositoryBundle,
  workspaceId: WorkspaceId,
  inputs: readonly SourceCollectionInput[],
): Promise<WorkspaceSourceView['collections']> {
  const existing = new Map(
    (await tx.collections.listByWorkspace(workspaceId)).map((row) => [row.slug, row]),
  )
  const now = deps.clock.now()
  const placed: WorkspaceSourceView['collections'][number][] = []
  // In order, inside the transaction that records the source.
  // oxlint-disable-next-line quill/no-independent-await-in-loop -- one transaction's writes, in the order configured
  for (const input of inputs) {
    const row = await placeCollection(deps, tx, workspaceId, existing.get(input.slug), input, now)
    placed.push({ collectionId: row.id, path: input.path, slug: row.slug, name: row.name })
  }
  return placed
}

async function placeCollection(
  deps: WorkspaceSourceDependencies,
  tx: RepositoryBundle,
  workspaceId: WorkspaceId,
  existing: CollectionRow | undefined,
  input: SourceCollectionInput,
  now: Date,
): Promise<CollectionRow> {
  if (existing === undefined) {
    return await tx.collections.create({
      id: collectionId(deps.ids.uuid()),
      workspaceId,
      name: input.name,
      slug: input.slug,
      now,
    })
  }
  return existing.name === input.name
    ? existing
    : await tx.collections.rename(existing.id, input.name)
}

/** The workspace's source and how far it has synced, or null for a native workspace. */
export async function getWorkspaceSource(
  deps: Pick<WorkspaceSourceDependencies, 'uow'>,
  workspaceId: WorkspaceId,
): Promise<WorkspaceSourceView | null> {
  const { repos } = deps.uow
  const source = await repos.workspaceSources.find(workspaceId)
  if (source === null) return null
  const [rows, state] = await Promise.all([
    repos.collections.listByIds(source.collections.map(({ collectionId: id }) => id)),
    repos.sourceSyncState.find(workspaceId),
  ])
  const byId = new Map(rows.map((row) => [row.id, row]))
  const collections = source.collections.flatMap((collection) => {
    const row = byId.get(collection.collectionId)
    return row === undefined ? [] : [{ ...collection, slug: row.slug, name: row.name }]
  })
  return { source, collections, state }
}

export type RequestManualSourceSyncResult =
  | { readonly kind: 'requested' }
  /** The workspace reads from no source. */
  | { readonly kind: 'not-sourced' }

/**
 * An administrator's "Sync now" (ADR-061, "Freshness"): the same outbox event
 * the webhook and the reconciliation write, so it is handled by the one sync
 * job, off the request path, and a sync already running is not doubled.
 */
export async function requestManualSourceSync(
  deps: Pick<WorkspaceSourceDependencies, 'uow' | 'clock' | 'ids'>,
  command: { readonly workspaceId: WorkspaceId; readonly requestedBy: UserId },
): Promise<RequestManualSourceSyncResult> {
  const source = await deps.uow.repos.workspaceSources.find(command.workspaceId)
  if (source === null) return { kind: 'not-sourced' }
  const now = deps.clock.now()
  await deps.uow.run(async (tx) => {
    await tx.events.record(
      sourceSyncRequested,
      { workspaceId: command.workspaceId, trigger: 'manual' },
      now,
    )
    await tx.audit.write({
      id: deps.ids.uuid(),
      type: WORKSPACE_SOURCE_AUDIT_EVENTS.syncRequested,
      actorUserId: command.requestedBy,
      targetType: 'workspace',
      targetId: command.workspaceId,
      metadata: {},
      now,
    })
  })
  return { kind: 'requested' }
}
