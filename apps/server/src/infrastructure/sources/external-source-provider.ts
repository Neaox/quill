import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { ExternalSourceError, getSecret, SOURCE_MANIFEST_PATH } from '@quill/application'
import type {
  ExternalSource,
  ExternalSourceProvider,
  OutboundHostPolicy,
  SecretsDependencies,
  WorkspaceSourceCredential,
} from '@quill/application'
import { GitCliExternalSource } from '@quill/content-store'
import type { GitCliExternalSourceOptions, SourceCredential } from '@quill/content-store'
import type { WorkspaceId } from '@quill/domain'

/**
 * The `ExternalSourceProvider` port over the `git` CLI adapter (ADR-061):
 * reads the workspace's stored source, and opens it with the instance's
 * outbound policy, a cache directory of its own, and its credential.
 *
 * **Opened lazily.** The adapter checks the installed `git` and its settings
 * when it opens, and the sync job asks for the source before it takes its lock
 * and starts recording what happens. Opening on first use moves every such
 * failure — `git` missing or too old, a path or branch it refuses — inside the
 * job, where it is recorded on the source's sync state for an administrator
 * to read, rather than retried by the outbox with nobody told.
 *
 * **The credential is read at each request**, from the secrets store, and
 * never kept (ADR-034): rotating the secret takes effect on the next fetch.
 * A credential whose secret is gone or does not open stops the sync with
 * `credential-unavailable` rather than fetching anonymously, which would
 * report a private repository as missing.
 *
 * **Opened on the manifest alone.** The source's paths come from its
 * manifest at the head, which the sync job reads first and then narrows the
 * source to (ADR-061, "Fetching"), so nothing the manifest does not name is
 * fetched first. Paths are not strict: a manifest's glob is fetched by the
 * directory in front of it, as the ADR's default has it, and a glob with no
 * such directory is refused.
 *
 * **A draft is opened for a preview** the same way, under the same policy,
 * but in a fresh directory of its own beside the sources' caches, removed
 * when the preview ends whatever happened, and with deadlines a person
 * waiting at a form can bear (`PREVIEW_LIMITS`).
 */

/** How long a preview may take to fetch, and how much any one command may write. */
export const PREVIEW_LIMITS = {
  fetchDeadlineMs: 60_000,
  networkTimeoutMs: 60_000,
  localTimeoutMs: 30_000,
  maxOutputBytes: 16 * 1024 * 1024,
} as const

export interface ExternalSourceProviderOptions {
  /** The unit of work the source is read with, and the secrets store its credential is read from. */
  readonly secrets: SecretsDependencies
  readonly outboundPolicy: OutboundHostPolicy
  /** Each sourced workspace's clone lives in a directory of its own under this one. */
  readonly cacheRoot: string
  /** An egress proxy enforcing the outbound policy on every connection (ADR-061). */
  readonly egressProxy?: string | undefined
  /** Accept `file://` remotes. Tests only. */
  readonly allowFileRemotesForTesting?: boolean
  /** Opens the adapter; replaced by a test that needs to see what it was asked for. */
  readonly open?: (options: GitCliExternalSourceOptions) => Promise<ExternalSource>
}

export function createExternalSourceProvider(
  options: ExternalSourceProviderOptions,
): ExternalSourceProvider {
  const open = options.open ?? ((settings) => GitCliExternalSource.open(settings))
  return {
    async forWorkspace(workspaceId: WorkspaceId) {
      const source = await options.secrets.uow.repos.workspaceSources.find(workspaceId)
      // A disconnected source is a record, never synced again.
      if (source === null || source.disconnectedAt !== null) return null
      const settings: GitCliExternalSourceOptions = {
        ...common(source.credential, source.manifestPath),
        remote: source.remote,
        branch: source.branch,
        cacheDirectory: join(options.cacheRoot, workspaceId),
      }
      return {
        source: openedOnFirstUse(() => open(settings)),
        settings: {
          collections: source.collections,
          history: source.history,
          commitMessages: source.commitMessages,
          manifestEntry: source.manifestEntry,
          manifestPath: source.manifestPath,
        },
        configuredAt: source.updatedAt,
      }
    },

    async withDraft(draft, work) {
      await mkdir(options.cacheRoot, { recursive: true })
      // `preview-` never names a workspace's cache, whose directories are UUIDs.
      const directory = await mkdtemp(join(options.cacheRoot, 'preview-'))
      try {
        const source = await open({
          ...common(draft.credential, draft.manifestPath ?? null),
          ...PREVIEW_LIMITS,
          remote: draft.remote,
          branch: draft.branch,
          cacheDirectory: directory,
        })
        return await work(source)
      } finally {
        await rm(directory, { recursive: true, force: true, maxRetries: 5 })
      }
    },
  }

  /** What every source is opened with: the manifest alone, the policy, and its credential. */
  function common(credential: WorkspaceSourceCredential | null, manifestPath: string | null) {
    return {
      paths: [manifestPath ?? SOURCE_MANIFEST_PATH],
      strictPrefixes: false,
      outboundPolicy: options.outboundPolicy,
      credential: credentialFor(options.secrets, credential),
      ...(options.egressProxy === undefined ? {} : { egressProxy: options.egressProxy }),
      ...(options.allowFileRemotesForTesting === true ? { allowFileRemotesForTesting: true } : {}),
    }
  }
}

function credentialFor(
  secrets: SecretsDependencies,
  credential: WorkspaceSourceCredential | null,
): () => Promise<SourceCredential | null> {
  if (credential === null) return () => Promise.resolve(null)
  return async () => {
    const found = await getSecret(secrets, credential.secretName)
    if (found.kind === 'secret') return { username: credential.username, password: found.value }
    throw new ExternalSourceError(
      'credential-unavailable',
      found.kind === 'not-found'
        ? `The source's credential names the secret "${credential.secretName}", which is not stored.`
        : `The secret "${credential.secretName}" does not open with this instance's master key.`,
    )
  }
}

/** An `ExternalSource` that opens the real one when it is first asked anything, and once. */
export function openedOnFirstUse(open: () => Promise<ExternalSource>): ExternalSource {
  let opened: Promise<ExternalSource> | undefined
  const source = (): Promise<ExternalSource> => (opened ??= open())
  return {
    head: async () => await (await source()).head(),
    fetch: async () => await (await source()).fetch(),
    narrow: async (paths) => {
      await (await source()).narrow(paths)
    },
    async *files(revision) {
      yield* (await source()).files(revision)
    },
    file: async (revision, path) => await (await source()).file(revision, path),
    async *readFiles(fileIds) {
      yield* (await source()).readFiles(fileIds)
    },
    async *history(since, until) {
      yield* (await source()).history(since, until)
    },
    async *changes(from, to) {
      yield* (await source()).changes(from, to)
    },
    present: async (revision, paths) => await (await source()).present(revision, paths),
  }
}
