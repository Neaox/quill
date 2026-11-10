import { getRouteApi, Link } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'

import { defaultForgeViewTemplate, forgeViewUrl } from '@quill/domain'
import {
  Button,
  buttonClassName,
  Callout,
  LocalTime,
  RelativeTime,
  textLinkClassName,
} from '@quill/ui'

import {
  awaitsSyncAfterSave,
  useLoadedWorkspace,
  useMe,
  useSyncSourceNow,
  useWorkspaceSource,
  type WorkspaceSourceDto,
} from '../../lib/api/index.ts'
import { now as wallClock } from '../../lib/time/clock.ts'
import { SettingsSection } from '../settings/settings-frame.tsx'
import { CopyableAddress } from './copyable-address.tsx'
import {
  describeRefusal,
  describeSourceFailure,
  manifestProblem,
  shortRevision,
  withoutRevision,
} from './source-words.ts'

const routeApi = getRouteApi('/_authenticated/w/$workspaceSlug/source')

/** How long "Sync now" counts as under way when no attempt is recorded: a sync with nothing new records none. */
const AWAIT_ATTEMPT_MS = 2 * 60_000

type Sync = NonNullable<WorkspaceSourceDto['sync']>

/** A file's address on the forge at a commit, or null when the forge's addresses are not known. */
type ForgeLink = (revision: string, path: string) => string | null

/**
 * A sourced workspace's repository (ADR-061, "A failed sync never empties a
 * workspace"). It answers one question first — is the workspace in step with
 * its branch? — with "Sync now" beside the answer, then lists what there is to
 * fix, folded to a line when there is nothing, then the settings. An
 * instance administrator changes them on the settings page, with a preview
 * of what the change does; whoever else manages the workspace reads them.
 *
 * "Sync now" asks the same job every other trigger asks. The page asks again
 * every few seconds while a sync is under way, and from the press until an
 * attempt newer than the one seen at the press is recorded, so it moves to
 * the outcome on its own.
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
  const canChange = useMe().data?.isInstanceAdmin === true
  // When the page was opened: a save just before it is a sync on its way (`lib/time/clock.ts`).
  const [openedAt] = useState(wallClock)

  /* v8 ignore next -- the loader awaited this entry, so it is here on the first render. */
  if (source.data === undefined) return undefined
  const data = source.data
  if (data.disconnectedAt !== null) {
    return (
      <DisconnectedRecord
        source={data}
        name={workspace.name}
        disconnectedAt={data.disconnectedAt}
      />
    )
  }
  const sync = data.sync
  const awaiting = askedAfter !== undefined && (sync?.lastAttemptAt ?? null) === askedAfter.attempt
  // Saving the settings asks for a sync; until it is attempted, it is on its way.
  const syncing = data.syncing || awaiting || awaitsSyncAfterSave(data, openedAt)
  const template = data.viewTemplate ?? defaultForgeViewTemplate(data.remote)
  const forgeLink: ForgeLink = (revision, path) =>
    template === null ? null : forgeViewUrl(template, revision, path)

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
    <div className="flex min-w-0 flex-col gap-10 px-4 py-8 sm:px-8">
      <div className="flex max-w-(--layout-content) flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {workspace.name} repository
          </h1>
          <p className="mt-1 text-sm text-muted">
            This workspace is read from a repository. Its documents are edited there, and each push
            to <code>{data.branch}</code> arrives here as a new revision.
          </p>
        </div>
        <SyncStatus sync={sync} syncing={syncing} branch={data.branch} forgeLink={forgeLink} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            variant="secondary"
            size="sm"
            loading={syncNow.isPending || syncing}
            disabled={syncing}
            onClick={requestSync}
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>
          <p className="text-xs text-muted">
            {syncing
              ? 'This page updates when the sync is done.'
              : 'Fetches the branch now, rather than waiting for the next push or the daily check.'}
          </p>
        </div>
        {syncNow.isError ? (
          <Callout tone="danger" title="Couldn't ask for a sync">
            {syncNow.error.message}
          </Callout>
        ) : undefined}
      </div>

      <ToFix sync={sync} forgeLink={forgeLink} />
      <Settings
        source={data}
        workspaceId={workspace.id}
        workspaceSlug={workspace.slug}
        canChange={canChange}
      />
    </div>
  )
}

/**
 * The repository a disconnected workspace was read from (ADR-061, amendment
 * of 11 November 2026): a read-only record. It says where the pages came
 * from and at which commit, keeps the lists as that commit left them, and
 * offers nothing to do, because nothing is read from the repository again.
 */
function DisconnectedRecord({
  source,
  name,
  disconnectedAt,
}: {
  readonly source: WorkspaceSourceDto
  readonly name: string
  readonly disconnectedAt: string
}) {
  const template = source.viewTemplate ?? defaultForgeViewTemplate(source.remote)
  const forgeLink: ForgeLink = (revision, path) =>
    template === null ? null : forgeViewUrl(template, revision, path)
  const revision = source.sync?.lastSyncedRevision ?? null
  return (
    <div className="flex min-w-0 flex-col gap-10 px-4 py-8 sm:px-8">
      <div className="flex max-w-(--layout-content) flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {name} repository
          </h1>
          <p className="mt-1 text-sm text-muted">
            This workspace was read from a repository until it was disconnected. Its documents are
            written here now; this is the record of where they came from.
          </p>
        </div>
        <Callout tone="info" title="Disconnected">
          <p className="min-w-0 break-words">
            Disconnected from <code className="break-all">{source.remote}</code>
            {revision === null ? undefined : (
              <>
                {' '}
                at <Revision value={revision} />
              </>
            )}{' '}
            on <LocalTime value={disconnectedAt} />.
          </p>
          <p className="text-sm text-muted">
            Links in the pages’ text still lead where they did, and links to the repository’s other
            files go to that commit.
          </p>
        </Callout>
      </div>
      <ToFix sync={source.sync} forgeLink={forgeLink} disconnected />
      <Settings source={source} workspaceId="" workspaceSlug="" canChange={false} disconnected />
    </div>
  )
}

function SyncStatus({
  sync,
  syncing,
  branch,
  forgeLink,
}: {
  readonly sync: Sync | null
  readonly syncing: boolean
  readonly branch: string
  readonly forgeLink: ForgeLink
}) {
  const synced =
    sync === null || sync.lastSyncedRevision === null ? null : (
      <>
        <Revision value={sync.lastSyncedRevision} />
        {sync.lastSyncedAt === null ? undefined : (
          <>
            , synced <RelativeTime value={sync.lastSyncedAt} />
          </>
        )}
      </>
    )
  if (syncing) {
    return (
      <Callout tone="info" title="Syncing now">
        Fetching <code>{branch}</code> from the repository.{' '}
        {sync === null || sync.lastSyncedRevision === null ? (
          'Documents appear when it finishes.'
        ) : (
          <>
            Readers see <Revision value={sync.lastSyncedRevision} /> until then.
          </>
        )}
      </Callout>
    )
  }
  if (sync === null) {
    return (
      <Callout tone="info" title="Not synced yet">
        The first sync hasn’t run yet. Documents appear when it finishes.
      </Callout>
    )
  }
  if (sync.failure !== null) {
    const { failure } = sync
    const located = failure.reason === 'invalid-manifest' ? manifestProblem(failure.message) : null
    const fileLink =
      located === null || failure.revision === null
        ? null
        : forgeLink(failure.revision, located.path)
    return (
      <Callout tone="danger" title="The last sync stopped">
        <p className="font-medium text-foreground">{describeSourceFailure(failure.reason)}</p>
        {located === null ? (
          <p className="text-sm break-words text-muted">{withoutRevision(failure.message)}</p>
        ) : (
          <p>
            {fileLink === null ? (
              <code>{located.path}</code>
            ) : (
              <a className={textLinkClassName()} href={fileLink} target="_blank" rel="noreferrer">
                <code>{located.path}</code>
              </a>
            )}
            {located.line === null ? undefined : <>, line {located.line}</>}: {located.problem}
          </p>
        )}
        <p className="text-sm text-muted">
          {failure.revision === null ? (
            'Tried'
          ) : (
            <>
              Tried at <Revision value={failure.revision} />,
            </>
          )}{' '}
          <RelativeTime value={sync.lastAttemptAt} />.{' '}
          {synced === null ? (
            'Nothing has synced yet, so the workspace is empty.'
          ) : (
            <>Readers still see {synced}; nothing was taken away.</>
          )}
        </p>
      </Callout>
    )
  }
  return (
    <Callout tone="success" title="Up to date">
      The workspace matches <code>{branch}</code> at {synced}.
    </Callout>
  )
}

function Revision({ value }: { readonly value: string }) {
  return (
    <code title={value} className="font-mono">
      {shortRevision(value)}
    </code>
  )
}

/** A repository path, linked to the file on the forge at a revision when the forge's addresses are known. */
function RepositoryPath({
  path,
  revision,
  forgeLink,
}: {
  readonly path: string
  readonly revision: string
  readonly forgeLink: ForgeLink
}) {
  const href = forgeLink(revision, path)
  const code = <code className="break-all">{path}</code>
  return href === null ? (
    code
  ) : (
    <a className={textLinkClassName()} href={href} target="_blank" rel="noreferrer">
      {code}
    </a>
  )
}

/** One problem: what it is about on the first line, and why beneath it. Never wider than the page. */
function Problem({ title, detail }: { readonly title: ReactNode; readonly detail: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col gap-0.5 border-b border-border py-2.5 last:border-b-0">
      <span className="min-w-0 text-sm text-foreground">{title}</span>
      <span className="text-xs text-muted">{detail}</span>
    </li>
  )
}

function ProblemList({
  title,
  description,
  children,
}: {
  readonly title: string
  readonly description: string
  readonly children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-0.5 text-sm text-muted">{description}</p>
      </div>
      <ul aria-label={title} className="flex flex-col">
        {children}
      </ul>
    </section>
  )
}

/**
 * Files not stored, broken links and manifest keys not read: each list shown
 * with its explanation when it has something in it, and otherwise named in
 * one quiet line, so an empty page is short.
 */
function ToFix({
  sync,
  forgeLink,
  disconnected = false,
}: {
  readonly sync: Sync | null
  readonly forgeLink: ForgeLink
  /** The lists are a record: as the last sync before the disconnection left them. */
  readonly disconnected?: boolean
}) {
  const refused = sync?.refused ?? []
  const links = sync?.brokenLinks ?? null
  const keys = sync?.unknownKeys ?? []
  const empty = [
    ...(refused.length === 0 ? ['no file was left out'] : []),
    ...(links !== null && links.length === 0 ? ['every relative link goes somewhere'] : []),
    ...(keys.length === 0 ? ['the manifest has no key this release ignores'] : []),
  ]
  const nothing = refused.length === 0 && (links?.length ?? 0) === 0 && keys.length === 0
  // Before anything has synced there is nothing to look at, and the status says why.
  if (nothing && (sync === null || sync.lastSyncedRevision === null)) return undefined
  /*
   * Which revision the lists describe. Only a sync that finishes writes them
   * (`recordSynced`); a failed attempt leaves them as they were, so after a
   * failure they still describe the last revision that synced, not the one
   * the sync stopped at, and the page says so rather than letting "nothing to
   * fix" read as a verdict on the failing commit.
   */
  const asOf =
    sync?.lastSyncedRevision === null || sync?.lastSyncedRevision === undefined ? (
      'From the last attempt'
    ) : (
      <>
        As of <Revision value={sync.lastSyncedRevision} />,{' '}
        {disconnected
          ? 'the commit it was disconnected at'
          : `the last revision that synced${sync.failure === null ? '' : ', before the sync that stopped'}`}
      </>
    )

  return (
    <SettingsSection level={2} title="Files, links and manifest keys">
      {nothing ? undefined : <p className="text-sm text-muted">{asOf}:</p>}
      {refused.length === 0 ? undefined : (
        <ProblemList
          title="Files not stored"
          description="Files under the source’s paths the sync could not store. Each keeps the version stored before, if there was one."
        >
          {refused.map((file) => (
            <Problem
              key={file.path}
              title={
                <RepositoryPath path={file.path} revision={file.revision} forgeLink={forgeLink} />
              }
              detail={
                <>
                  {describeRefusal(file.reason)}, at <Revision value={file.revision} />
                </>
              }
            />
          ))}
        </ProblemList>
      )}
      {links === null || links.length === 0 ? undefined : (
        <ProblemList
          title="Broken links"
          description="Relative links to a path that is not in the repository. Readers see their words, with no link, until the path exists."
        >
          {links.map((link) => (
            <Problem
              key={`${link.path} ${link.url}`}
              title={<code className="break-all">{link.url}</code>}
              detail={
                <>
                  In{' '}
                  <RepositoryPath path={link.path} revision={link.revision} forgeLink={forgeLink} />
                  , at <Revision value={link.revision} />
                </>
              }
            />
          ))}
        </ProblemList>
      )}
      {keys.length === 0 ? undefined : (
        <ProblemList
          title="Manifest keys not read"
          description="Keys in the manifest this release gives no meaning to. They are kept, so a team can hold its own keys there."
        >
          {keys.map(({ key, line }) => (
            <Problem
              key={`${key}:${line ?? ''}`}
              title={<code className="break-all">{key}</code>}
              detail={
                line === null
                  ? 'Its line wasn’t recorded: the manifest names it inside a one-line list or map.'
                  : `Line ${line}`
              }
            />
          ))}
        </ProblemList>
      )}
      {empty.length === 0 && links !== null ? undefined : (
        <p className="text-sm text-muted">
          {nothing ? <>{asOf}: nothing to fix. </> : undefined}
          {empty.length === 0
            ? undefined
            : `${nothing ? '' : 'Also: '}${capitalised(sentence(empty), nothing)}`}
          {links === null && !disconnected
            ? ' Broken links are checked at the next sync.'
            : undefined}
        </p>
      )}
    </SettingsSection>
  )
}

/** A sentence that starts one of its own, rather than continuing another. */
function capitalised(text: string, start: boolean): string {
  return start ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text
}

/** Clauses joined into the rest of a sentence: "a, b and c." */
function sentence(clauses: readonly string[]): string {
  const joined =
    clauses.length === 1
      ? clauses.join('')
      : `${clauses.slice(0, -1).join(', ')} and ${clauses.at(-1) ?? ''}`
  return `${joined}.`
}

/** Labels and values, as a description list that folds to one column on a phone. */
function Facts({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <dl
      aria-label={label}
      className="grid min-w-0 grid-cols-1 gap-x-6 text-sm sm:grid-cols-[minmax(10rem,auto)_minmax(0,1fr)] sm:gap-y-3"
    >
      {children}
    </dl>
  )
}

function Fact({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted">{term}</dt>
      <dd className="mb-3 min-w-0 text-foreground sm:mb-0">{children}</dd>
    </div>
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
  workspaceSlug,
  canChange,
  disconnected = false,
}: {
  readonly source: WorkspaceSourceDto
  readonly workspaceId: string
  readonly workspaceSlug: string
  /** Whether the reader may change them: instance administration, as the API is. */
  readonly canChange: boolean
  /** The settings it was read with, kept as a record once it was disconnected. */
  readonly disconnected?: boolean
}) {
  const hook = (forge: string) =>
    `${globalThis.location.origin}/api/workspaces/${workspaceId}/source/webhooks/${forge}`
  return (
    <SettingsSection
      level={2}
      title={disconnected ? 'Settings it was read with' : 'Settings'}
      description={
        disconnected
          ? 'As they were when it was disconnected. They no longer change anything.'
          : canChange
            ? 'Where the repository has a manifest, the manifest decides the collections. Changing a setting shows what the change does before it is saved.'
            : 'Where the repository has a manifest, the manifest decides the collections. Only an instance administrator can change these settings.'
      }
    >
      {canChange ? (
        <div>
          <Link
            to="/w/$workspaceSlug/source/settings"
            params={{ workspaceSlug }}
            className={buttonClassName({ size: 'sm', variant: 'secondary' })}
          >
            Change settings
          </Link>
        </div>
      ) : undefined}
      <CopyableAddress label="Repository" value={source.remote} />
      <Facts label="Settings">
        <Fact term="Branch">
          <code>{source.branch}</code>
        </Fact>
        {source.manifestEntry === null ? undefined : (
          <Fact term="Manifest workspace">
            <code>{source.manifestEntry}</code>
          </Fact>
        )}
        <Fact term="Collections">
          {source.collections.length === 0 ? (
            <span className="text-muted">None: the repository’s manifest decides them</span>
          ) : (
            <ul className="flex flex-col gap-1">
              {source.collections.map((collection) => (
                <li key={collection.collectionId}>
                  {collection.name} <span className="text-muted">from</span>{' '}
                  <code className="break-all">{collection.path}</code>
                </li>
              ))}
            </ul>
          )}
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
              <code className="break-all">{source.credential.secretName}</code>
            </span>
          )}
        </Fact>
        <Fact term="Push webhook">
          {disconnected ? (
            <span className="text-muted">None since it was disconnected.</span>
          ) : source.webhookSecret === null ? (
            <span className="text-muted">
              None. Pushes arrive with the daily check, or when someone opens a document.
            </span>
          ) : (
            <div className="flex min-w-0 flex-col gap-3">
              <span>
                <span className="text-muted">Signed with the secret</span>{' '}
                <code className="break-all">{source.webhookSecret}</code>. Give the forge one of
                these addresses, and the secret’s value as the webhook’s secret.
              </span>
              <CopyableAddress label="GitHub webhook" value={hook('github')} />
              <CopyableAddress label="GitLab webhook" value={hook('gitlab')} />
            </div>
          )}
        </Fact>
      </Facts>
    </SettingsSection>
  )
}
