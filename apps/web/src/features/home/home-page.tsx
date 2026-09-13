import { Link } from '@tanstack/react-router'

import { Callout, Spinner, tv } from '@quill/ui'

import { useMe } from '../../lib/api/auth.ts'
import { useWorkspaceList } from '../../lib/api/index.ts'
import type { WorkspaceSummaryDto } from '../../lib/api/types.ts'
import { workspaceReference } from '../../lib/routing/document-reference.ts'
import { SetupCard } from '../admin/setup-card.tsx'
import { AppPage } from '../layout/app-page.tsx'
import { useHomeSections, type HomeDocument } from './use-home-sections.ts'

export const homePageStyles = tv({
  slots: {
    sectionTitle: 'text-sm font-semibold tracking-tight text-foreground',
    note: 'mt-1 text-2xs leading-relaxed text-muted',
    list: 'mt-3 flex flex-col divide-y divide-border rounded-lg border border-border',
    row: [
      'flex items-center justify-between gap-4 px-4 py-2.5 text-sm',
      'hover:bg-surface focus-visible:relative focus-visible:outline-2',
      'focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
    ],
    rowTitle: 'truncate font-medium text-foreground',
    rowMeta: 'meta shrink-0 text-muted',
  },
})

/**
 * The signed-in home (`docs/design/home.md`): the person is the subject, not a
 * workspace. Sections in the document's order, each omitted when it is empty
 * rather than shown blank — Continue, Your workspaces, Recently updated — with
 * the administrator's set-up card above them until there is a workspace.
 *
 * A person with exactly one workspace never sees this page: the route sends
 * them straight into it.
 */
export function HomePage() {
  const me = useMe()
  const workspaces = useWorkspaceList()
  const sections = useHomeSections(workspaces.data ?? [])
  const styles = homePageStyles()

  return (
    <AppPage brandLinksHome={false}>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Home</h1>

      {me.data?.isInstanceAdmin === true ? <SetupCard /> : undefined}

      {workspaces.isPending ? (
        <p className="flex items-center gap-2 text-sm text-muted" aria-busy="true">
          <Spinner /> Loading your workspaces
        </p>
      ) : workspaces.isError ? (
        <Callout tone="danger" title="Your workspaces could not be loaded">
          Reload the page to try again. If it keeps failing, tell your administrator.
        </Callout>
      ) : workspaces.data.length === 0 ? (
        <NoWorkspaces isInstanceAdmin={me.data?.isInstanceAdmin === true} />
      ) : (
        <>
          {sections.continueWith.length === 0 ? undefined : (
            <DocumentSection
              id="continue"
              title="Continue"
              note="Work that has never been published. A lock somebody else holds, and a draft ahead of what is published, are not in the workspace document list — each document answers those for itself."
              documents={sections.continueWith}
            />
          )}

          <section aria-labelledby="your-workspaces">
            <h2 id="your-workspaces" className={styles.sectionTitle()}>
              Your workspaces
            </h2>
            <p className={styles.note()}>
              Everything you can read, grouped by the part of the organisation it belongs to.
            </p>
            <WorkspaceGroups workspaces={workspaces.data} />
          </section>

          {sections.recentlyUpdated.length === 0 ? undefined : (
            <DocumentSection
              id="recently-updated"
              title="Recently updated"
              note="The newest published changes across your workspaces."
              documents={sections.recentlyUpdated}
            />
          )}
        </>
      )}
    </AppPage>
  )
}

function DocumentSection({
  id,
  title,
  note,
  documents,
}: {
  readonly id: string
  readonly title: string
  readonly note: string
  readonly documents: readonly HomeDocument[]
}) {
  const styles = homePageStyles()

  return (
    <section aria-labelledby={id}>
      <h2 id={id} className={styles.sectionTitle()}>
        {title}
      </h2>
      <p className={styles.note()}>{note}</p>
      <ul className={styles.list()}>
        {documents.map((document) => (
          <li key={document.id}>
            <Link
              to="/w/$workspaceSlug/d/$documentId"
              params={{ workspaceSlug: document.workspaceSlug, documentId: document.reference }}
              search={{}}
              className={styles.row()}
            >
              <span className={styles.rowTitle()}>{document.title}</span>
              <span className={styles.rowMeta()}>
                {document.workspaceName} &middot;{' '}
                <time dateTime={document.updatedAt}>{document.updatedAt.slice(0, 10)}</time>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function NoWorkspaces({ isInstanceAdmin }: { readonly isInstanceAdmin: boolean }) {
  return isInstanceAdmin ? (
    <Callout tone="info" title="No workspaces yet">
      Nothing has been set up. The card above walks through the first unit and the first workspace.
    </Callout>
  ) : (
    <Callout tone="info" title="No workspaces yet">
      You have not been given access to a workspace. Ask an administrator of your organisation to
      add you to one.
    </Callout>
  )
}

/** Workspaces grouped by their unit's path, so a company and its teams read as a tree of headings. */
function WorkspaceGroups({ workspaces }: { readonly workspaces: readonly WorkspaceSummaryDto[] }) {
  const groups = Map.groupBy(workspaces, (workspace) => workspace.unit.path.join(' / '))

  return (
    <div className="mt-3 flex flex-col gap-6">
      {[...groups].map(([unitPath, members]) => (
        <section key={unitPath} aria-labelledby={`unit-${members[0]?.unit.id ?? unitPath}`}>
          <h3
            id={`unit-${members[0]?.unit.id ?? unitPath}`}
            className="meta mb-3 text-xs tracking-caps text-muted uppercase"
          >
            {unitPath}
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {members.map((workspace) => (
              <li key={workspace.id}>
                <Link
                  to="/w/$workspaceSlug"
                  params={{ workspaceSlug: workspaceReference(workspace) }}
                  className="focus-ring block rounded-md border border-border bg-surface-raised px-4 py-3 transition-colors hover:border-accent"
                >
                  <span className="block font-medium text-foreground">{workspace.name}</span>
                  <span className="mt-0.5 block text-xs text-muted">{workspace.unit.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
