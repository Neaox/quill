import { getRouteApi } from '@tanstack/react-router'
import { useState } from 'react'

import { Button, Callout, Spinner } from '@quill/ui'

import {
  ApiError,
  useDocuments,
  useLoadedWorkspace,
  useWorkspaceTree,
} from '../../lib/api/index.ts'
import { CreateCollectionDialog } from './collection-dialogs.tsx'
import { DocumentList } from './document-list.tsx'
import { NewDocumentDialog } from './new-document-dialog.tsx'
import { ShellActions } from './shell-slots.tsx'

const routeApi = getRouteApi('/_authenticated/w/$workspaceSlug/')

/**
 * The workspace's front page: its documents, grouped by collection in the
 * order the navigation shows them.
 *
 * It renders inside the shell the workspace layout already drew, so there is
 * no header, rail or sidebar here — only the page, and the one control that
 * belongs to it in the header bar. Its empty state is the first real step:
 * a workspace with no collections cannot hold a document, so that is what it
 * offers rather than a sentence about it.
 */
export function WorkspaceHomePage() {
  const { workspaceSlug } = routeApi.useParams()
  // The layout's loader awaited this entry before the page rendered, so there
  // is no pending state of its own here (ADR-013). The segment may be a slug
  // or an id; everything keyed by a workspace is keyed by the id the server
  // answered with (see `workspace-layout.tsx`).
  const workspace = useLoadedWorkspace(workspaceSlug).data
  const workspaceId = workspace.id
  const documents = useDocuments(workspaceId)
  const tree = useWorkspaceTree(workspaceId)
  const [creatingCollection, setCreatingCollection] = useState(false)

  const collections = tree.data?.collections ?? []
  const collectionOrder = collections.map((collection) => collection.id)
  const collectionNames = new Map(collections.map((collection) => [collection.id, collection.name]))

  return (
    <div className="px-8 py-8">
      <ShellActions>
        <NewDocumentDialog
          workspaceId={workspaceId}
          workspaceSlug={workspace.slug}
          trigger={<Button size="sm">New document</Button>}
        />
      </ShellActions>

      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{workspace.name}</h1>

      <div className="mt-6">
        {documents.isPending || tree.isPending ? (
          <Spinner className="size-5" />
        ) : documents.isError ? (
          <Callout tone="danger" title="Couldn't load documents">
            {documents.error instanceof ApiError ? documents.error.message : 'Please try again.'}
          </Callout>
        ) : collections.length === 0 ? (
          <div className="flex max-w-lg flex-col items-start gap-3">
            <Callout tone="info" title="Nothing in here yet">
              Documents live in collections, and this workspace has none. Make the first one — you
              can rename it later, and nothing points at it by name.
            </Callout>
            <Button
              onClick={() => {
                setCreatingCollection(true)
              }}
            >
              Create the first collection
            </Button>
            <CreateCollectionDialog
              open={creatingCollection}
              onOpenChange={setCreatingCollection}
              workspaceId={workspaceId}
            />
          </div>
        ) : (
          <DocumentList
            workspaceSlug={workspace.slug}
            documents={documents.data}
            collectionNames={collectionNames}
            collectionOrder={collectionOrder}
          />
        )}
      </div>
    </div>
  )
}
