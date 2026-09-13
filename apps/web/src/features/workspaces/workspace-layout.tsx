import { Outlet, getRouteApi, useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { DocumentShell, type DocumentState, type DocumentStatus } from '@quill/ui'

import { useDocument, useLoadedWorkspace } from '../../lib/api/index.ts'
import { revisionDate } from '../../lib/documents/revision-labels.ts'
import { workspaceLink } from '../../lib/routing/document-reference.ts'
import { RouterLink } from '../../lib/routing/router-link.tsx'
import { SignedInHeader } from '../auth/signed-in-header.tsx'
import { ThemeToggle } from '../theme/theme-toggle.tsx'
import { useThemePreference } from '../theme/use-theme-preference.ts'
import { DocumentActionsProvider } from './document-actions.tsx'
import { ShellSlotsProvider, type ShellSlotNodes } from './shell-slots.tsx'
import { WorkspaceTree, buildRailItems } from './workspace-navigation.tsx'

const DOCUMENT_STATE: Readonly<Record<string, DocumentState>> = {
  draft: 'draft',
  published: 'published',
  archived: 'archived',
}

const routeApi = getRouteApi('/_authenticated/w/$workspaceSlug')

/**
 * The frame everything inside a workspace is read and written in.
 *
 * Rendered **once**, by the layout route: the header, the icon rail and the
 * navigation sidebar keep their DOM nodes while a person moves between the
 * workspace home and every document in it, so nothing flashes and the
 * sidebar's scroll position survives the navigation. Pages render inside
 * `main`, through `<Outlet />`, and contribute to the frame by rendering into
 * it — see `shell-slots.tsx` for why that is a portal rather than a prop.
 *
 * The header's facts are derived here from the route rather than pushed up by
 * the page, so they change in the same commit the page does. Only what is
 * actually known is shown: a workspace home has a name and no revision, so it
 * has no revision fact, and no dash standing in for one.
 *
 * TODO(M3): every surface below renders the default identity's signature
 * variants, because nothing tells it otherwise — no M2 route carries a theme
 * or a layout. ADR-028's amendment settles where they come from (identity per
 * organisation, layout per workspace) and schedules both with the workspace
 * settings work; when `GET /api/workspaces/{idOrSlug}` answers with them, this
 * is the one place that reads them and wraps the shell in
 * `ThemeVariantsProvider`. Until then the machinery is exercised only by the
 * design showcase, which is why it lives behind `@quill/ui/theme`.
 */
export function WorkspaceLayout() {
  /*
   * The workspace, read from the entry the layout's loader already filled —
   * `useSuspenseQuery`, so there is no pending branch here to write and none
   * to go stale. Reading the *query* rather than the loader's return value is
   * what makes a rename land in the header immediately: the mutation writes
   * the new name into both spellings of this entry (ADR-035), and a loader's
   * return value would sit there saying the old one until the route re-ran.
   */
  const segment = routeApi.useParams().workspaceSlug
  const workspace = useLoadedWorkspace(segment).data
  const workspaceId = workspace.id
  const workspaceSlug = workspace.slug
  const workspaceName = workspace.name
  const { documentId } = useParams({ strict: false })
  const document = useDocument(documentId)
  const { preference, setPreference } = useThemePreference()

  // The slot containers, held in state and set by a callback ref, so they
  // exist from the first paint and keep their identity for the life of the
  // workspace. Memoised so a page's portal is not torn down on every render.
  const [actionsNode, setActionsNode] = useState<HTMLElement | null>(null)
  const [asideNode, setAsideNode] = useState<HTMLElement | null>(null)
  const slots = useMemo<ShellSlotNodes>(
    () => ({ actions: actionsNode, aside: asideNode }),
    [actionsNode, asideNode],
  )

  const onDocument = documentId !== undefined
  const currentDocument = onDocument ? document.data : undefined
  // The URL carries a *reference* (ADR-035), the tree carries ids: what marks
  // the current row is the document the reference resolved to, never the
  // spelling in the address bar.
  const currentDocumentId = currentDocument?.id

  const status: DocumentStatus = {
    path:
      currentDocument === undefined
        ? [{ label: workspaceName }]
        : [
            { label: workspaceName, link: workspaceLink(workspaceSlug) },
            { label: currentDocument.title },
          ],
    ...(currentDocument === undefined
      ? {}
      : {
          state: DOCUMENT_STATE[currentDocument.status] ?? 'draft',
          updated: revisionDate(currentDocument.updatedAt),
        }),
  }

  const shell = (
    <DocumentShell
      status={status}
      railItems={buildRailItems(workspaceSlug)}
      railCurrentId="documents"
      linkComponent={RouterLink}
      skipLabel="Skip to content"
      navigation={
        <WorkspaceTree
          workspaceSlug={workspaceSlug}
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          {...(currentDocumentId === undefined ? {} : { currentDocumentId })}
        />
      }
      actions={
        <>
          <div ref={setActionsNode} className="contents" />
          <ThemeToggle
            preference={preference}
            onPreferenceChange={setPreference}
            className="hidden sm:flex"
          />
          <SignedInHeader compact />
        </>
      }
      /*
       * The column itself is the slot: only reading a document renders into
       * it, and a column nothing has rendered into collapses (`:empty` in the
       * design system's stylesheet), so the editor and every notice shown in
       * `main` are not framed by an empty strip. A container *inside* the
       * column could not do that — it would be a child, and the column would
       * never be empty — and a page that registered its aside on mount would
       * paint a frame without it first.
       */
      asideRef={setAsideNode}
    >
      <ShellSlotsProvider nodes={slots}>
        <Outlet />
      </ShellSlotsProvider>
    </DocumentShell>
  )

  // The move and delete dialogs belong to whichever document is open, and are
  // reached from both the tree row and the document header, so they are
  // provided around the whole shell rather than owned by either trigger.
  return documentId === undefined ? (
    shell
  ) : (
    <DocumentActionsProvider
      workspaceSlug={workspaceSlug}
      workspaceId={workspaceId}
      documentId={documentId}
      {...(currentDocumentId === undefined ? {} : { resolvedDocumentId: currentDocumentId })}
    >
      {shell}
    </DocumentActionsProvider>
  )
}
