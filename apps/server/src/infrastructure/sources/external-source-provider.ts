import { join } from 'node:path'

import { ExternalSourceError, getSecret } from '@quill/application'
import type {
  ExternalSource,
  ExternalSourceProvider,
  OutboundHostPolicy,
  SecretsDependencies,
  WorkspaceSourceRow,
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
 */

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
      if (source === null) return null
      const settings: GitCliExternalSourceOptions = {
        remote: source.remote,
        branch: source.branch,
        paths: source.collections.map(({ path }) => path),
        // Paths are literal until the manifest brings globs (`checkSourcePath`).
        strictPrefixes: true,
        cacheDirectory: join(options.cacheRoot, workspaceId),
        outboundPolicy: options.outboundPolicy,
        credential: credentialFor(options.secrets, source),
        ...(options.egressProxy === undefined ? {} : { egressProxy: options.egressProxy }),
        ...(options.allowFileRemotesForTesting === true
          ? { allowFileRemotesForTesting: true }
          : {}),
      }
      return {
        source: openedOnFirstUse(() => open(settings)),
        settings: {
          collections: source.collections,
          history: source.history,
          commitMessages: source.commitMessages,
        },
      }
    },
  }
}

function credentialFor(
  secrets: SecretsDependencies,
  source: WorkspaceSourceRow,
): () => Promise<SourceCredential | null> {
  const { credential } = source
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
    async *files(revision) {
      yield* (await source()).files(revision)
    },
    async *readFiles(fileIds) {
      yield* (await source()).readFiles(fileIds)
    },
    async *history(since, until) {
      yield* (await source()).history(since, until)
    },
    async *changes(from, to) {
      yield* (await source()).changes(from, to)
    },
  }
}
