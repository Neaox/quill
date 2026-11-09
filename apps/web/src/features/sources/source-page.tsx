import { getRouteApi } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'

import { Badge, Button, Callout, DataTable, RelativeTime, Spinner } from '@quill/ui'

import {
  useLoadedWorkspace,
  useSyncSourceNow,
  useWorkspaceSource,
  type WorkspaceSourceDto,
} from '../../lib/api/index.ts'
import { SettingsSection } from '../settings/settings-frame.tsx'
import { ShellActions } from '../workspaces/shell-slots.tsx'
import { describeRefusal, describeSourceFailure, shortRevision } from './source-words.ts'

const routeApi = getRouteApi('/_authenticated/w/$workspaceSlug/source')

/** How long "Sync now" counts as under way when no attempt is recorded: a sync with nothing new records none. */
const AWAIT_ATTEMPT_MS = 2 * 60_000

type Sync = NonNullable<WorkspaceSourceDto['sync']>

/**
 * A sourced workspace's repository (ADR-061, "A failed sync never empties a
 * workspace"): the answer first — up to date, syncing, never synced, or
 * stopped and why — then the facts behind it, then the lists an
 * administrator works through: files not stored, links that go nowhere,
 * manifest keys this release does not read. Then the settings, which are read
 * here and changed through the API by an instance administrator.
 *
 * "Sync now" asks the same job every other trigger asks. The page asks again
 * every few seconds while a sync is under way, and from the press until the
 * attempt is recorded, so it moves to the outcome on its own.
 */
export function SourcePage() {
  const { workspaceSlug } = routeApi.useParams()
  const workspace = useLoadedWorkspace(workspaceSlug).data
  /*
   * The attempt that was the last one when "Sync now" was pressed, kept until
   * a newer one is recorded: compared with the server's own times, so the
   * reader's clock never decides. `undefined` is "nothing asked".
   */
  const [askedAfter, setAskedAfter] = useState<{ readonly attempt: string | null } | undefined>()
  const source = useWorkspaceSource(workspace.id, { awaiting: askedAfter !== undefined })
  const syncNow = useSyncSourceNow(workspace.id)

  /* v8 ignore next -- the loader awaited this entry, so it is here on the first render. */
  if (source.data === undefined) return undefined
  const data = source.data
  const sync = data.sync
  const awaiting = askedAfter !== undefined && (sync?.lastAttemptAt ?? null) === askedAfter.attempt
  const syncing = data.syncing || awaiting

  function requestSync() {
    const asked = { attempt: sync?.lastAttemptAt ?? null }
    syncNow.mutate(undefined, {
      onSuccess: () => {
        setAskedAfter(asked)
        // A sync with nothing new records no attempt, so the wait has an end.
        setTimeout(() => {
          setAskedAfter((current) => (current === asked ? undefined : current))
        }, AWAIT_ATTEMPT_MS)
      },
    })
  }

  return (
    <div className="flex flex-col gap-10 px-4 py-8 sm:px-8">
      <ShellActions>
        <Button
          size="sm"
          loading={syncNow.isPending}
          disabled={syncing}
          aria-describedby={syncing ? 'source-sync-reason' : undefined}
          onClick={requestSync}
        >
          Sync now
        </Button>
      </ShellActions>

      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {workspace.name} repository
          </h1>
          <p className="mt-1 max-w-(--layout-content) text-sm text-muted">
            This workspace is read from a repository. Nothing in it is written here: each push to{' '}
            <code>{data.branch}</code> arrives as a new revision.
          </p>
        </div>
        <SyncStatus sync={sync} syncing={syncing} />
        {syncNow.isError ? (
          <Callout
            className="max-w-(--layout-content)"
            tone="danger"
            title="Couldn't ask for a sync"
          >
            {syncNow.error.message}
          </Callout>
        ) : undefined}
      </div>

      <SettingsSection level={2} title="Sync" wide>
        <Facts label="Sync">
          <Fact term="Last good revision">
            {sync === null || sync.lastSyncedRevision === null ? (
              <span className="text-muted">None yet</span>
            ) : (
              <span className="flex flex-wrap items-baseline gap-x-2">
                <Revision value={sync.lastSyncedRevision} />
                {sync.lastSyncedAt === null ? undefined : (
                  <span className="text-muted">
                    synced <RelativeTime value={sync.lastSyncedAt} />
                  </span>
                )}
              </span>
            )}
          </Fact>
          <Fact term="Last attempt">
            {sync === null ? (
              <span className="text-muted">None yet</span>
            ) : (
              <RelativeTime value={sync.lastAttemptAt} />
            )}
          </Fact>
        </Facts>
      </SettingsSection>

      <Refused sync={sync} />
      <BrokenLinks sync={sync} />
      <UnknownKeys sync={sync} />
      <Settings source={data} workspaceId={workspace.id} />
    </div>
  )
}

function SyncStatus({ sync, syncing }: { readonly sync: Sync | null; readonly syncing: boolean }) {
  const width = 'max-w-(--layout-content)'
  if (syncing) {
    return (
      <Callout className={width} tone="info" title="Syncing now">
        <p id="source-sync-reason" aria-busy="true" className="flex items-center gap-2">
          <Spinner /> Fetching from the repository. This page updates when it is done.
        </p>
      </Callout>
    )
  }
  if (sync === null) {
    return (
      <Callout className={width} tone="info" title="Not synced yet">
        The first sync starts when the source is configured, and has not been attempted yet.
      </Callout>
    )
  }
  if (sync.failure !== null) {
    const { failure } = sync
    return (
      <Callout className={width} tone="danger" title="The last sync stopped">
        <p>
          It stopped because {describeSourceFailure(failure.reason)}
          {failure.revision === null ? (
            ''
          ) : (
            <>
              {' '}
              at <Revision value={failure.revision} />
            </>
          )}
          .
        </p>
        <p>
          <code className="break-words">{failure.message}</code>
        </p>
        <p>
          {sync.lastSyncedRevision === null
            ? 'Nothing has been synced yet, so the workspace is empty.'
            : 'Readers still see the last good revision: nothing was taken away.'}
        </p>
      </Callout>
    )
  }
  return (
    <Callout className={width} tone="success" title="Up to date">
      The workspace holds the branch as it was at the last good revision.
    </Callout>
  )
}

/** Labels and values, as a description list that folds to one column on a phone. */
function Facts({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <dl
      aria-label={label}
      className="grid grid-cols-1 gap-x-6 text-sm sm:grid-cols-[minmax(10rem,auto)_1fr] sm:gap-y-3"
    >
      {children}
    </dl>
  )
}

function Fact({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="pt-3 text-muted first:pt-0 sm:pt-0">{term}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  )
}

function Revision({ value }: { readonly value: string }) {
  return (
    <code title={value} className="font-mono">
      {shortRevision(value)}
    </code>
  )
}

function Refused({ sync }: { readonly sync: Sync | null }) {
  const files = sync?.refused ?? []
  return (
    <SettingsSection
      level={2}
      title="Files not stored"
      description="Files under the source’s paths that the sync could not store. Each keeps the version stored before, if there was one."
      wide
    >
      {files.length === 0 ? (
        <p className="text-sm text-muted">None. Every file under the source’s paths was stored.</p>
      ) : (
        <DataTable label="Files not stored">
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Why</th>
              <th scope="col">Revision</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr key={file.path}>
                <td>
                  <code>{file.path}</code>
                </td>
                <td>{describeRefusal(file.reason)}</td>
                <td>
                  <Revision value={file.revision} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </SettingsSection>
  )
}

function BrokenLinks({ sync }: { readonly sync: Sync | null }) {
  const links = sync?.brokenLinks ?? null
  return (
    <SettingsSection
      level={2}
      title="Broken links"
      description="Relative links to a path that is not in the repository at the revision synced. They read as plain text until the path exists."
      wide
    >
      {links === null ? (
        <p className="text-sm text-muted">Not checked yet: the next sync checks them.</p>
      ) : links.length === 0 ? (
        <p className="text-sm text-muted">None. Every relative link goes somewhere.</p>
      ) : (
        <DataTable label="Broken links">
          <thead>
            <tr>
              <th scope="col">In</th>
              <th scope="col">Link</th>
              <th scope="col">Revision</th>
            </tr>
          </thead>
          <tbody>
            {links.map((link) => (
              <tr key={`${link.path} ${link.url}`}>
                <td>
                  <code>{link.path}</code>
                </td>
                <td>
                  <code>{link.url}</code>
                </td>
                <td>
                  <Revision value={link.revision} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </SettingsSection>
  )
}

function UnknownKeys({ sync }: { readonly sync: Sync | null }) {
  const keys = sync?.unknownKeys ?? []
  return (
    <SettingsSection
      level={2}
      title="Manifest keys not read"
      description="Keys in the manifest this release gives no meaning to. They are kept, so a team can hold its own keys there."
      wide
    >
      {keys.length === 0 ? (
        <p className="text-sm text-muted">None.</p>
      ) : (
        <ul aria-label="Manifest keys not read" className="flex flex-wrap gap-x-4 gap-y-2">
          {keys.map(({ key, line }) => (
            <li key={`${key}:${line ?? ''}`} className="flex items-center gap-1.5 text-sm">
              <code>{key}</code>
              {line === null ? undefined : <Badge>Line {line}</Badge>}
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  )
}

const HISTORY: Readonly<Record<string, string>> = {
  full: 'Every revision, replayed',
  head: 'Only the head, imported once',
}

const COMMIT_MESSAGES: Readonly<Record<string, string>> = {
  subject: 'Each commit’s first line is its change note',
  none: 'Not shown',
}

const OUTSIDE_LINKS: Readonly<Record<string, string>> = {
  forge: 'To the file on the forge, at the synced commit',
  text: 'As plain text',
}

function Settings({
  source,
  workspaceId,
}: {
  readonly source: WorkspaceSourceDto
  readonly workspaceId: string
}) {
  const hook = (forge: string) =>
    `${globalThis.location.origin}/api/workspaces/${workspaceId}/source/webhooks/${forge}`
  return (
    <SettingsSection
      level={2}
      title="Settings"
      description="An instance administrator changes these through the API. Where the repository has a manifest, the manifest decides the collections."
      wide
    >
      <Facts label="Settings">
        <Fact term="Repository">
          <code>{source.remote}</code>
        </Fact>
        <Fact term="Branch">
          <code>{source.branch}</code>
        </Fact>
        <Fact term="Collections">
          <ul className="flex flex-col gap-1">
            {source.collections.map((collection) => (
              <li key={collection.collectionId}>
                {collection.name} <span className="text-muted">from</span>{' '}
                <code>{collection.path}</code>
              </li>
            ))}
          </ul>
        </Fact>
        <Fact term="History">{HISTORY[source.history] ?? source.history}</Fact>
        <Fact term="Commit messages">
          {COMMIT_MESSAGES[source.commitMessages] ?? source.commitMessages}
        </Fact>
        <Fact term="Links outside the source">
          {OUTSIDE_LINKS[source.outsideLinks] ?? source.outsideLinks}
        </Fact>
        <Fact term="Credential">
          {source.credential === null ? (
            <span className="text-muted">None: the repository is read anonymously</span>
          ) : (
            <span>
              <code>{source.credential.username}</code>{' '}
              <span className="text-muted">with the secret</span>{' '}
              <code>{source.credential.secretName}</code>
            </span>
          )}
        </Fact>
        <Fact term="Push webhook">
          {source.webhookSecret === null ? (
            <span className="text-muted">
              None. Pushes arrive with the daily reconciliation, or when a document is opened.
            </span>
          ) : (
            <span className="flex flex-col gap-1">
              <span>
                <span className="text-muted">Signed with the secret</span>{' '}
                <code>{source.webhookSecret}</code>
              </span>
              <span className="mt-1 text-muted">GitHub</span>
              <code className="break-all">{hook('github')}</code>
              <span className="mt-1 text-muted">GitLab</span>
              <code className="break-all">{hook('gitlab')}</code>
            </span>
          )}
        </Fact>
      </Facts>
    </SettingsSection>
  )
}
